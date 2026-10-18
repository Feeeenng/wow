const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { loadSource } = require("./source-loader.cjs");
const { waitUntil, processExited } = require("./wait-until.cjs");

// 必须先以该独立标识构建，禁止启动正式应用或覆盖已有验收状态。
const appId = "com.wow.recorder.bosstimelinevalidation20261018";
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const executable = path.resolve(argument("--exe"));
const sourceIndex = path.resolve(argument("--index"));
const output = path.resolve(argument("--output"));
const playwright = require(path.resolve(argument("--playwright")));
const resources = path.resolve(__dirname, "../src-tauri/resources/game-data");
const { pullToVideo } = loadSource("../shared/replay/mapping.ts");
const roaming = path.resolve(process.env.APPDATA, appId);
const local = path.resolve(process.env.LOCALAPPDATA, appId);
const report = { cases: [], pageErrors: [], remoteIconRequests: [], forcedStops: 0 };
let child, page;

async function hash(file) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });

async function launch() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  child = spawn(path.join(output, "app/wow-recorder-client.exe"), [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling` } });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => fs.appendFileSync(path.join(output, "native.log"), data));
  const browser = await waitUntil(() => playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null), (value) => !!value, "独立WebView2连接", 30000);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("request", (request) => { if (/^https:\/\/(?:assets\.rpglogs\.com|wow\.zamimg\.com)\//.test(request.url())) report.remoteIconRequests.push(request.url()); });
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && !!document.querySelector("nav"));
  assert.equal(await invoke("plugin:app|identifier"), appId);
}

async function close() {
  if (page && !page.isClosed()) await invoke("plugin:window|close", { label: "main" }).catch(() => {});
  if (child && !processExited(child)) await waitUntil(async () => processExited(child), Boolean, "应用正常退出", 10000).catch(() => {});
  if (child && !processExited(child)) { report.forcedStops++; child.kill(); await waitUntil(async () => processExited(child), Boolean, "强制退出", 5000); }
  page = null;
}

async function main() {
  assert.ok(fs.readFileSync(executable).includes(Buffer.from(appId)), "不是独立标识构建，禁止启动");
  assert.ok(!fs.existsSync(roaming) && !fs.existsSync(local), "验收目录必须全新，不能覆盖已有状态");
  const original = JSON.parse(fs.readFileSync(sourceIndex, "utf8"));
  const selected = original.pulls.find((pull) => pull.difficultyId === 16 && pull.state === "ready" && pull.timelineEvents.length > 10000);
  assert.ok(selected, "需要已有真实史诗战斗及HLS作为只读输入");
  const protectedFiles = [sourceIndex, selected.videoPath, ...fs.readdirSync(path.dirname(selected.playbackPath)).map((file) => path.join(path.dirname(selected.playbackPath), file))];
  const before = await Promise.all(protectedFiles.map(hash));
  fs.mkdirSync(path.join(output, "app"), { recursive: true });
  fs.copyFileSync(executable, path.join(output, "app/wow-recorder-client.exe"));
  fs.cpSync(resources, path.join(output, "app/game-data"), { recursive: true });
  fs.mkdirSync(roaming, { recursive: true });
  const hls = path.join(roaming, "recordings", selected.pullId, "hls");
  fs.cpSync(path.dirname(selected.playbackPath), hls, { recursive: true });
  const pull = { ...selected, playbackPath: path.join(hls, "index.m3u8") };
  fs.writeFileSync(path.join(roaming, "recording-index.json"), JSON.stringify({ schemaVersion: 2, activePull: null, pulls: [pull], sources: [], diagnostics: [] }));
  fs.writeFileSync(path.join(roaming, "client-state.json"), JSON.stringify({ schemaVersion: 1, sections: { replay: { catalogSource: "local", selectedPullId: pull.pullId, bookmarksMs: { [pull.pullId]: 5000 }, offsetsMs: {}, muted: true, volume: 0, playbackRate: 1 } } }));
  try {
    await launch();
    const boss = JSON.parse(fs.readFileSync(path.join(resources, "boss-abilities.json"), "utf8"));
    const records = await invoke("get_spell_metadata", { spellIds: boss.spells.map((spell) => spell.spellId) });
    assert.equal(records.length, boss.spells.length);
    const unique = [...new Map(records.map((record) => [record.iconUrl, record])).values()];
    assert.ok(unique.every((record) => record.iconUrl?.startsWith("http://spell-icon.localhost/")));
    const decoded = await page.evaluate(async (urls) => Promise.all(urls.map(async (url) => {
      const response = await fetch(url), bytes = [...new Uint8Array(await response.arrayBuffer())];
      const image = new Image(); image.src = url; await image.decode();
      return { url, status: response.status, type: response.headers.get("content-type"), width: image.naturalWidth, height: image.naturalHeight, bytes };
    })), unique.map((record) => record.iconUrl));
    for (const image of decoded) {
      assert.equal(image.status, 200); assert.ok(image.width > 0 && image.height > 0);
      const icon = new URL(image.url).pathname.slice(1);
      assert.equal(image.type, icon.endsWith(".png") ? "image/png" : "image/jpeg");
      assert.equal(crypto.createHash("sha256").update(Buffer.from(image.bytes)).digest("hex"), boss.spells.find((spell) => spell.icon === icon).iconSha256);
    }
    report.cases.push({ name: "native-metadata-and-local-image-decoding", spells: records.length, images: decoded.length, passed: true });
    await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
    await page.waitForFunction(() => !!document.querySelector("[data-boss-skill-name]") && [...document.querySelectorAll('[data-replay-track="boss"] img')].every((image) => image.complete && image.naturalWidth > 0));
    const expected = pullToVideo(pull, 5).seconds;
    await page.waitForFunction((time) => { const video = document.querySelector("video"); return video && video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - time) < .15; }, expected);
    const first = page.locator('[data-replay-track="boss"] > button:not([role="slider"])').first();
    const windowBeforeHover = await page.locator("[data-ruler-time]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ruler-time")));
    await first.hover();
    const details = page.locator('.ant-popover:not(.ant-popover-hidden) [aria-label="时间轴分组事件详情"]');
    await details.getByText(/技能 ID：/).first().waitFor();
    assert.deepEqual(await page.locator("[data-ruler-time]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ruler-time"))), windowBeforeHover, "悬浮不可移动时间窗");
    await details.hover();
    report.hoverSkillIds = await details.locator("code").allTextContents();
    await details.screenshot({ path: path.join(output, "skill-id.png"), animations: "disabled" });
    await page.mouse.move(400, 80);
    for (let index = 0; index < 11; index++) await page.getByRole("button", { name: "放大战斗时间轴" }).click();
    const saved = await waitUntil(() => invoke("get_replay_preferences"), (value) => value.timelineZoom > 8, "缩放偏好落盘");
    assert.equal(await page.getByRole("button", { name: "设置时间轴外观" }).count(), 0);
    assert.equal(await page.locator(".replay-axis-scroll").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, "Boss名称或计数不可撑宽画布");
    const labels = await page.locator("[data-ruler-time]").evaluateAll((nodes) => nodes.map((node) => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right })));
    for (let index = 1; index < labels.length; index++) assert.ok(labels[index - 1].right <= labels[index].left, "时间标签不可重叠");
    await page.screenshot({ path: path.join(output, "mythic-replay.png"), fullPage: true });
    report.cases.push({ name: "real-mythic-hls-skill-id-and-zoom-above-four", pullId: pull.pullId, zoom: saved.timelineZoom, passed: true });
    await close(); await launch();
    assert.equal((await invoke("get_replay_preferences")).timelineZoom, saved.timelineZoom);
    report.cases.push({ name: "native-zoom-restored-after-restart", passed: true });
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.remoteIconRequests, []);
    report.passed = true;
  } finally {
    await close();
    assert.deepEqual(await Promise.all(protectedFiles.map(hash)), before, "只读输入发生变化");
    report.originalFilesUnchanged = protectedFiles.length;
    // 只清理由本脚本新建的独立标识目录，先检查绝对路径边界。
    for (const directory of [roaming, local]) {
      assert.equal(path.basename(directory), appId);
      assert.ok(path.dirname(directory) === path.resolve(process.env.APPDATA) || path.dirname(directory) === path.resolve(process.env.LOCALAPPDATA));
      fs.rmSync(directory, { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
