const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { loadSource } = require("./source-loader.cjs");
const { installReplayFixture } = require("./browser-replay-fixture.cjs");

// 浏览器运行真实 React/HLS.js 与合成 H.264/AAC；仅将 Tauri IPC 替换为可控测试边界。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const fixtureRoot = path.resolve(argument("--fixture"));
const outputRoot = path.resolve(argument("--output"));
const playwright = require(path.resolve(argument("--playwright")));
const clientRoot = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "fixture.json"), "utf8"));
const spells = JSON.parse(fs.readFileSync(path.join(clientRoot, "src-tauri/resources/game-data/spells.json"), "utf8"));
const defaults = loadSource("src/features/obs/model.ts");
const { pullToVideo } = loadSource("../shared/replay/mapping.ts");
const report = { cases: [], pageErrors: [], consoleErrors: [], boundary: "真实网页与媒体，Tauri IPC 使用夹具；不替代实际桌面 IPC 验收" };
fs.mkdirSync(outputRoot, { recursive: true });

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const root = path.join(clientRoot, "dist");
  const filename = path.resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  const extension = path.extname(filename);
  const kinds = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
  if (!fs.existsSync(filename)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": kinds[extension] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let corruptPlaylist = false;
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  await installReplayFixture({ page, fixture, spells, defaults });
  const tooltips = JSON.parse(fs.readFileSync(path.join(clientRoot, "src-tauri/resources/game-data/spell-tooltips.json"), "utf8"));
  await page.addInitScript(({ tooltips }) => {
    const previous = window.__TAURI_INTERNALS__.invoke;
    const state = window.__REPLAY_TEST__;
    state.favorites = [];
    state.deleted = [];
    state.opened = [];
    state.managementFailure = false;
    window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
      if (command === "get_spell_tooltips") return tooltips.spells.filter((spell) => args.spellIds.includes(spell.spellId));
      if (command === "list_managed_recordings") {
        if (state.managementFailure) throw new Error("明确管理查询失败夹具");
        return [state.fixture, ...state.extraRecordings].filter((item) => !state.deleted.includes(item.pullId)).map((item) => ({ pullId: item.pullId, bytes: 1048576, isFavorited: state.favorites.includes(item.pullId), canDelete: item.state === "ready", canOpenDirectory: true, blockedReason: item.state === "ready" ? null : "录像正在处理中" }));
      }
      if (command === "list_local_recordings") {
        const result = await previous(command, args);
        return result.filter((item) => !state.deleted.includes(item.pullId));
      }
      if (command === "set_recording_favorite") { state.favorites = args.isFavorited ? [...state.favorites, args.pullId] : state.favorites.filter((id) => id !== args.pullId); return; }
      if (command === "open_recording_directory") { state.opened.push(args.pullId); return; }
      if (command === "delete_recording") { state.deleted.push(args.pullId); return; }
      return previous(command, args);
    };
  }, { tooltips });
  await page.route("http://spell-icon.localhost/**", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({ path: path.join(clientRoot, "src-tauri/resources/game-data/icons", name), contentType: name.endsWith(".png") ? "image/png" : "image/jpeg", headers: { "Access-Control-Allow-Origin": "*" } });
  });

  await page.route("http://local-replay.localhost/**", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    if (name === "index.m3u8" && corruptPlaylist) {
      await route.fulfill({ status: 200, body: "invalid-playlist", contentType: "application/vnd.apple.mpegurl", headers: { "Access-Control-Allow-Origin": "*" } }); return;
    }
    await route.fulfill({ path: path.join(path.dirname(fixture.playbackPath), name),
      contentType: name.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4",
      headers: { "Access-Control-Allow-Origin": "*" } });
  });




  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /回放/ }).click();
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2 && !document.querySelector("video").seeking);
    const ruler = page.locator(".replay-timeline-ruler");
    const times = () => page.locator("[data-ruler-time]").evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.rulerTime)));
    let labels = await times();
    assert.ok(labels.at(-1) - labels[0] < 20);
    assert.ok(labels.slice(1, -1).every(Number.isInteger));
    const bounds = await ruler.boundingBox();
    const before = await page.locator("video").evaluate((video) => video.currentTime);
    await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + 20);
    const hover = Number(await ruler.locator("[data-hover-seconds]").getAttribute("data-hover-seconds"));
    assert.ok(Math.abs(hover - (labels[0] + (labels.at(-1) - labels[0]) * .4)) < .02);
    assert.ok(Math.abs(await page.locator("video").evaluate((video) => video.currentTime) - before) < .1);
    await page.mouse.click(bounds.x + bounds.width * .4, bounds.y + 20);
    await page.waitForFunction((time) => { const video = document.querySelector("video"); return video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - time) < .12; }, pullToVideo(fixture, hover).seconds);
    report.cases.push({ name: "逐秒展开、悬停精确秒数不跳转、点击标尺定位", hover, passed: true });

    const marker = page.locator('[data-replay-track="boss"] > button:not([role="slider"])').first();
    await marker.hover();
    const card = page.getByRole("article", { name: "技能详情" });
    await card.waitFor();
    await page.waitForFunction(() => document.querySelector(".replay-skill-tooltip p")?.textContent.includes("伤害"));
    assert.equal(await card.getByText(/点击回看|施法成功|nil/).count(), 0);
    assert.ok((await card.textContent()).includes("技能 ID"));
    await card.screenshot({ path: path.join(outputRoot, "skill-details.png"), animations: "disabled" });
    report.cases.push({ name: "Boss真实中文说明卡，无施法流水", passed: true });
    await page.mouse.move(400, 100);

    const player = page.locator('[data-replay-track="player"] > button:not([role="slider"])').first();
    await player.hover();
    await page.waitForFunction(() => [...document.querySelectorAll(".replay-skill-tooltip footer")].some((node) => node.textContent.includes("642") && node.textContent.includes("12.1.5.70391")));
    assert.equal(await card.getByText(/点击回看|施法成功|nil/).count(), 0);
    report.cases.push({ name: "当前视角玩家技能同样显示真实说明", passed: true });
    await page.mouse.move(400, 100);
    for (const [width, height] of [[1440, 900], [1080, 720]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => { const node = document.querySelector(".replay-axis-content"); return node.scrollWidth <= node.clientWidth + 1; });
      const dimensions = await page.locator(".replay-axis-content").evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, page: document.documentElement.scrollWidth, screen: innerWidth }));
      assert.ok(dimensions.scroll <= dimensions.width + 1);
      assert.ok(dimensions.page <= dimensions.screen);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(outputRoot, "timeline-spacing.png"), animations: "disabled" });
    report.cases.push({ name: "两种桌面视口无横向溢出", passed: true });

    const manage = async () => {
      await page.getByRole("button", { name: "更多录像操作" }).click();
      await page.getByRole("button", { name: "录像管理", exact: true }).click();
      await page.getByRole("dialog").waitFor();
    };
    await manage();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^收藏/ }).first().click();
    await dialog.getByRole("button", { name: /^取消收藏/ }).first().waitFor();
    await dialog.getByLabel("只看收藏").check();
    assert.equal(await dialog.locator("tbody tr[data-row-key]").count(), 1);
    await dialog.getByLabel("搜索管理录像").fill("不存在的首领");
    await dialog.getByText("没有符合筛选条件的录像").waitFor();
    await dialog.getByLabel("搜索管理录像").fill("");
    await dialog.getByRole("button", { name: /打开.*录像目录/ }).first().click();
    await page.waitForFunction(() => window.__REPLAY_TEST__.opened.length === 1);
    await dialog.screenshot({ path: path.join(outputRoot, "recording-library.png"), animations: "disabled" });
    report.cases.push({ name: "管理搜索、收藏筛选与打开目录IPC", passed: true });
    await dialog.getByRole("button", { name: /删除.*客户端成片/ }).first().click();
    await page.getByText("只删除客户端成片与回放文件，导入原片、OBS源录像和日志全部保留。", { exact: true }).waitFor();
    await page.getByRole("button", { name: /^取\s*消$/ }).click();
    assert.equal(await page.evaluate(() => window.__REPLAY_TEST__.deleted.length), 0);
    await dialog.getByRole("button", { name: /删除.*客户端成片/ }).first().click();
    await page.getByRole("button", { name: "删除成片", exact: true }).click();
    await dialog.getByText("暂无本地录像").waitFor();
    report.cases.push({ name: "删除二次确认、取消无副作用、成功刷新空态", passed: true });

    await page.evaluate(() => { window.__REPLAY_TEST__.managementFailure = true; });
    await dialog.getByRole("button", { name: "刷新管理录像", exact: true }).click();
    await dialog.getByText("明确管理查询失败夹具").waitFor();
    await page.evaluate(() => { window.__REPLAY_TEST__.managementFailure = false; });
    await dialog.getByRole("button", { name: "重试刷新", exact: true }).click();
    await dialog.getByText("暂无本地录像").waitFor();
    report.cases.push({ name: "管理查询错误可见且能重试恢复", passed: true });
    await page.evaluate(() => { const state = window.__REPLAY_TEST__; state.extraRecordings = [{ ...state.fixture, pullId: "processing-fixture", state: "processing" }]; });
    await dialog.getByLabel("只看收藏").uncheck();
    await dialog.getByRole("button", { name: "刷新管理录像" }).click();
    await dialog.locator('tr[data-row-key="processing-fixture"]').waitFor();
    assert.equal(await dialog.getByRole("button", { name: /删除.*客户端成片/ }).isDisabled(), true);
    assert.equal(await dialog.getByRole("button", { name: /播放/ }).isDisabled(), true);
    report.cases.push({ name: "处理中的录像禁用播放和删除", passed: true });
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
  } catch (error) {
    report.failure = error.stack;
    await page.screenshot({ path: path.join(outputRoot, "failure.png"), animations: "disabled" });
    throw error;
  } finally {
    fs.writeFileSync(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
