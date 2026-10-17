const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { loadSource } = require("./source-loader.cjs");

// 真实 SVG 指针交互、React 和 HLS；保存边界为有 CAS 的内存 IPC，原生／PG 另行验收。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const fixture = JSON.parse(fs.readFileSync(path.join(argument("--fixture"), "fixture.json"), "utf8"));
const playwright = require(path.resolve(argument("--playwright")));
const clientRoot = path.resolve(__dirname, "..");
const defaults = loadSource("src/features/obs/model.ts");
const cloudId = "33333333-3333-4333-8333-333333333333";
const cloudPull = "22222222-2222-4222-8222-222222222222";
const documents = new Map();
const calls = { gets: [], saves: [] };
const report = { cases: [], pageErrors: [], boundary: "真实浏览器 SVG/指针/媒体；保存为可控 IPC，不替代原生写盘及团队API验收" };
let page, browser, server, failSave = false, cloudEditable = false;
const clone = (value) => structuredClone(value);
fs.mkdirSync(output, { recursive: true });
const cloudRecording = { ...clone(fixture), pullId: cloudId, sourceKind: "cloud", cloudTeamPullId: cloudPull, cloudStatus: "ready", battleKey: `team:${cloudPull}`,
  timelineEvents: [], timelineRevision: null, timelineComplete: false, videoPath: null, playbackPath: null, playbackUrl: `http://cloud-replay.localhost/${cloudId}/index.m3u8` };

async function main() {
  server = http.createServer((request, response) => {
    const root = path.join(clientRoot, "dist"), pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.exposeFunction("__ANNOTATION_NATIVE__", async (command, args) => {
    if (command === "get_cloud_settings") return { endpoint: "http://127.0.0.1:18000", teamId: "team", deviceId: "fixture", hasToken: true, connectionKey: "connection-one", identity: { userId: "user", displayName: "测试用户", teams: [{ teamId: "team", name: "团队", role: "member" }] } };
    if (command === "get_cloud_uploads" || command === "get_spell_metadata") return [];
    if (command === "list_local_recordings") return [clone(fixture)];
    if (command === "list_cloud_replays") return [clone(cloudRecording)];
    if (/^get_(local|cloud)_replay_annotations$/.test(command)) {
      calls.gets.push({ command, pullId: args.pullId });
      const doc = documents.get(args.pullId) ?? { version: 0, items: [] };
      return { ...clone(doc), canEdit: args.pullId !== cloudId || cloudEditable };
    }
    if (/^save_(local|cloud)_replay_annotations$/.test(command)) {
      calls.saves.push(clone({ command, ...args }));
      if (failSave) { failSave = false; throw new Error("模拟磁盘写入失败"); }
      if (args.pullId === cloudId && !cloudEditable) throw new Error("团队回放返回 HTTP 403");
      const doc = documents.get(args.pullId) ?? { version: 0, items: [] };
      if (args.request.expectedVersion !== doc.version) throw new Error("团队回放返回 HTTP 409");
      const next = { version: doc.version + 1, items: clone(args.request.items) };
      documents.set(args.pullId, next);
      return { ...clone(next), canEdit: true };
    }
    return null;
  });
  await page.addInitScript(({ defaults, fixture }) => {
    let callback = 0;
    const preferences = { selectedPullId: fixture.pullId, catalogSource: "local", bookmarksMs: {}, offsetsMs: {}, volume: 1, muted: true, playbackRate: 1, eventKinds: [], actorGuid: null, timelineTrackHeight: 30, timelineIconPercent: 80, timelineZoom: 1, timelineTrackOverrides: {}, customTimelineTracks: [] };
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, transformCallback: () => ++callback, unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command === "get_replay_preferences") return structuredClone(preferences);
        if (command === "set_replay_preferences") { Object.assign(preferences, args.preferences); return; }
        if (command === "get_obs_status") return defaults.disconnectedObsStatus;
        if (command === "get_obs_installation") return defaults.defaultInstallationStatus;
        if (command === "get_cached_obs_settings" || command === "get_live_session") return null;
        if (command === "get_recording_import_preferences") return { directory: "", logPaths: [] };
        if (command === "get_recording_import") return { status: "idle", taskId: null, totalRecordings: 0, processedRecordings: 0, importedCount: 0, skippedCount: 0, failedCount: 0, bytesRead: 0, totalBytes: 0, currentFile: null, error: null, issues: [], pullIds: [] };
        if (command === "plugin:event|listen") return ++callback;
        if (command === "plugin:window|is_maximized") return false;
        if (command.startsWith("plugin:")) return;
        return window.__ANNOTATION_NATIVE__(command, args);
      } };
  }, { defaults: { disconnectedObsStatus: defaults.disconnectedObsStatus, defaultInstallationStatus: defaults.defaultInstallationStatus }, fixture });
  await page.route(/^http:\/\/(local-replay|cloud-replay)\.localhost\//, async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    assert.match(file, /^(index\.m3u8|init\.mp4|segment-\d{5}\.m4s)$/);
    await route.fulfill({ path: path.join(path.dirname(fixture.playbackPath), file), contentType: file.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  const run = async (name, task) => { await task(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
  const navigate = (name) => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name, exact: true }).click();
  const canvas = () => page.locator("svg[data-annotation-canvas]");
  const shapes = () => canvas().locator("g[data-annotation-id]");
  const select = async (label, text) => {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    const popup = await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").elementHandle();
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content").getByText(text, { exact: true }).click();
    await popup.waitForElementState("hidden");
    await popup.dispose();
  };
  const draw = async (from, to, curved = false) => {
    const bounds = await canvas().boundingBox(); assert.ok(bounds && bounds.width > 0);
    const at = (value) => ({ x: bounds.x + value[0] * bounds.width, y: bounds.y + value[1] * bounds.height });
    const start = at(from), end = at(to);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    if (curved) await page.mouse.move(start.x + (end.x - start.x) / 2, end.y + 10, { steps: 5 });
    await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
  };
  const save = async () => {
    const before = calls.saves.length;
    await page.getByRole("button", { name: "保存标注", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-annotation-toolbar] .ant-btn-loading'));
    assert.equal(calls.saves.length, before + 1, "每次真实点击只提交一次快照");
  };
  await page.goto(`http://127.0.0.1:${server.address().port}`); await navigate("回放");
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
  await page.getByRole("combobox", { name: "标注工具", exact: true }).waitFor();
  await run("视频内容画布按比例排除黑边，进入工具暂停媒体", async () => {
    const bounds = await canvas().boundingBox();
    const info = await page.locator("video").evaluate((video) => ({ width: video.videoWidth, height: video.videoHeight, paused: video.paused }));
    assert.ok(Math.abs(bounds.width / bounds.height - info.width / info.height) < 0.001);
    assert.equal(info.paused, true);
    assert.equal(await page.getByText("标注未保存", { exact: true }).count(), 0);
  });
  await run("真实指针绘制箭头、画笔、方框及圆圈，坐标归一化", async () => {
    await draw([0.2, 0.5], [0.4, 0.75]);
    for (const [name, kind] of [["画笔", "pen"], ["方框", "rect"], ["圆圈", "ellipse"]]) {
      await select("标注工具", name); await draw([0.5, 0.5], [0.7, 0.75], kind === "pen");
      assert.equal(await canvas().locator(`g[data-annotation-kind='${kind}']`).count(), 1);
    }
    assert.equal(await shapes().count(), 4);
  });
  await run("元素属性、文字与团队标记是字面内容，撤销重做可恢复", async () => {
    await page.getByRole("spinbutton", { name: "标注线宽", exact: true }).fill("6");
    await page.keyboard.press("Tab");
    await select("标注工具", "文字");
    await page.getByRole("textbox", { name: "标注文字", exact: true }).fill("<script>只是文字</script>");
    await draw([0.2, 0.85], [0.2, 0.85]);
    assert.equal(await canvas().locator("script").count(), 0);
    assert.equal(await canvas().getByText("<script>只是文字</script>", { exact: true }).count(), 1);
    await select("标注工具", "团队标记");
    await page.getByRole("textbox", { name: "标注文字", exact: true }).fill("治疗集合");
    await draw([0.45, 0.85], [0.45, 0.85]);
    assert.equal(await shapes().count(), 6);
    await page.getByRole("button", { name: "撤销标注", exact: true }).click(); assert.equal(await shapes().count(), 5);
    await page.getByRole("button", { name: "重做标注", exact: true }).click(); assert.equal(await shapes().count(), 6);
    await page.getByRole("button", { name: "撤销标注", exact: true }).focus();
    await page.keyboard.press("Control+z"); assert.equal(await shapes().count(), 5);
    await page.keyboard.press("Control+y"); assert.equal(await shapes().count(), 6);
  });
  await run("选择拖动移动图形，保存快照后切页保留且不重复读取", async () => {
    await select("标注工具", "选择");
    const line = canvas().locator("g[data-annotation-kind='arrow'] line");
    const before = await line.getAttribute("x1");
    await draw([0.3, 0.625], [0.35, 0.68]);
    assert.notEqual(await line.getAttribute("x1"), before);
    await save();
    assert.equal(documents.get(fixture.pullId).items.length, 6);
    for (const item of documents.get(fixture.pullId).items) for (const point of item.points) assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
    const reads = calls.gets.length;
    await navigate("设置"); await navigate("回放");
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    assert.equal(await shapes().count(), 6);
    assert.equal(calls.gets.length, reads);
    await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
  });
  await run("保存失败保留草稿和已保存版本，重试及清空撤销有效", async () => {
    await page.getByRole("button", { name: "清空标注", exact: true }).click();
    assert.equal(await shapes().count(), 0);
    await page.getByRole("button", { name: "撤销标注", exact: true }).click();
    await select("标注工具", "箭头"); await draw([0.15, 0.55], [0.2, 0.7]);
    failSave = true; const version = documents.get(fixture.pullId).version;
    await save(); await page.getByText("标注读取或保存失败", { exact: true }).waitFor();
    assert.equal(documents.get(fixture.pullId).version, version);
    assert.equal(await shapes().count(), 7);
    await save(); assert.equal(documents.get(fixture.pullId).version, version + 1);
  });
  await run("缩放及全屏保持视频归一化图形位置", async () => {
    const snapshot = clone(documents.get(fixture.pullId));
    await page.setViewportSize({ width: 1080, height: 720 });
    const play = await page.locator("media-play-button").boundingBox();
    assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("svg[data-annotation-canvas]"), { x: play.x + play.width / 2, y: play.y + play.height / 2 }), false, "画布不能遮挡媒体控制栏");
    await page.screenshot({ path: path.join(output, "annotations-1080.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
    await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
    await page.keyboard.press("KeyT"); await page.waitForFunction(() => document.fullscreenElement !== null);
    assert.equal(await shapes().count(), 7);
    await page.keyboard.press("KeyT"); await page.waitForFunction(() => document.fullscreenElement === null);
    await page.locator("media-fullscreen-button").click();
    await page.waitForFunction(() => document.fullscreenElement?.tagName === "MEDIA-CONTROLLER");
    assert.equal(await shapes().count(), 7);
    await page.locator("media-fullscreen-button").click();
    await page.waitForFunction(() => document.fullscreenElement === null);
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.deepEqual(documents.get(fixture.pullId), snapshot);
  });
  await run("团队只读标注隔离，刷新权限后才可编辑", async () => {
    await page.getByText("团队录像", { exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
    await page.getByText("当前只可查看标注。", { exact: true }).waitFor();
    assert.equal(await shapes().count(), 0);
    assert.equal(await page.getByRole("combobox", { name: "标注工具", exact: true }).isDisabled(), true);
    cloudEditable = true;
    await page.getByRole("button", { name: "刷新标注", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="标注工具"]').disabled);
    await draw([0.2, 0.5], [0.4, 0.7]); await save();
    assert.equal(documents.get(cloudId).items.length, 1);
    assert.equal(documents.get(fixture.pullId).items.length, 7);
  });
  await run("版本冲突保留当前草稿，明确读取最新后才替换", async () => {
    await draw([0.5, 0.5], [0.6, 0.8]);
    const saved = documents.get(cloudId); documents.set(cloudId, { version: saved.version + 1, items: clone(saved.items) });
    await save();
    await page.getByText("标注版本已更新，当前草稿仍保留", { exact: true }).waitFor();
    assert.equal(await shapes().count(), 2);
    assert.equal(documents.get(cloudId).items.length, 1);
    await page.getByRole("button", { name: "读取最新", exact: true }).click();
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('svg[data-annotation-canvas] g[data-annotation-id]').length === 1);
    assert.equal(await page.getByText("标注未保存", { exact: true }).count(), 0);
  });
  await run("原生视频进度进入预滚尾滚时禁止错位绘制，回到战斗恢复标注", async () => {
    const saved = clone(documents.get(cloudId)), writes = calls.saves.length;
    for (const time of [0.5, 13.5]) {
      await page.locator("video").evaluate((video, seconds) => { video.currentTime = seconds; }, time);
      await page.getByText("当前画面不在可定位的战斗范围内，返回战斗时间后可编辑标注。", { exact: true }).waitFor();
      assert.equal(await canvas().count(), 0);
      assert.equal(await page.getByRole("combobox", { name: "标注工具", exact: true }).isDisabled(), true);
    }
    await page.locator("video").evaluate((video) => { video.currentTime = 3; });
    await canvas().waitFor();
    assert.equal(await page.getByRole("combobox", { name: "标注工具", exact: true }).isDisabled(), false);
    assert.equal(await shapes().count(), 1);
    assert.deepEqual(documents.get(cloudId), saved);
    assert.equal(calls.saves.length, writes);
  });
  await page.screenshot({ path: path.join(output, "annotations-1440.png"), fullPage: true });
  assert.deepEqual(report.pageErrors, []); report.calls = calls;
}

main().catch(async (error) => {
  report.error = error.stack; process.exitCode = 1; console.error(error);
  if (page) {
    report.calls = calls;
    report.accessibility = await page.locator('[data-annotation-toolbar]').ariaSnapshot();
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
    report.failureButtons = await page.locator('[data-annotation-toolbar] button').evaluateAll((elements) => elements.map((element) => ({ text: element.textContent, ariaLabel: element.getAttribute('aria-label'), hiddenAncestor: element.closest('[aria-hidden="true"]')?.outerHTML.slice(0,200), bounds: element.getBoundingClientRect().toJSON() })));
  }
}).finally(async () => {
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  if (browser) await browser.close(); if (server) await new Promise((resolve) => server.close(resolve));
});
