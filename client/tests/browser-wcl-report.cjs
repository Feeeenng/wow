const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { loadSource } = require("./source-loader.cjs");

// 真实 React/HLS，WCL 任务及 IPC 为受控边界；不访问真实报告或使用真实应用凭证。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const fixture = JSON.parse(fs.readFileSync(path.join(argument("--fixture"), "fixture.json"), "utf8"));
const playwright = require(path.resolve(argument("--playwright")));
const clientRoot = path.resolve(__dirname, "..");
const defaults = loadSource("src/features/obs/model.ts");
const recordId = "33333333-3333-4333-8333-333333333333";
const pullId = "22222222-2222-4222-8222-222222222222";
const calls = { status: 0, starts: [], events: [], localEvents: 0 };
const report = { cases: [], pageErrors: [], boundary: "真实网页/HLS，受控 WCL/IPC；非在线 WCL 授权验收" };
const wcl = { configured: false, canImport: true, status: "unbound", eventCount: 0, actors: [], actorBindings: [], revision: null };
const base = { ...fixture, sourceKind: "cloud", cloudTeamPullId: pullId, cloudStatus: "ready", pullId: recordId, battleKey: `team:${pullId}`,
  playerName: "测试视角", videoPath: null, playbackPath: null, playbackUrl: `http://cloud-replay.localhost/${recordId}/index.m3u8`,
  timelineEvents: [], timelineRevision: null, timelineComplete: false };
let browser, page, server, pendingPolls = 0, failImport = false;
fs.mkdirSync(output, { recursive: true });
const clone = (value) => structuredClone(value);
const actors = [{ actorId: 1, name: "同名WCL角色", type: "Player", subType: "Paladin", gameId: 1 }, { actorId: 2, name: "同名WCL角色", type: "Player", subType: "Priest", gameId: 2 }];
const event = (actorId, time) => ({ eventId: `wcl-${actorId}`, pullTimeMs: time, owner: "team", kind: "castSuccess", sourceName: "同名WCL角色", targetName: "目标", sourceGuid: "", targetGuid: "", spellId: actorId === 1 ? 642 : 17, spellName: actorId === 1 ? "WCL盾甲" : "WCL盾乙", extraSpellId: null, stackCount: null, identityNamespace: "wcl:abcdefghijklmnop", sourceActorId: actorId, targetActorId: null, sourceIsPlayer: true, targetIsPlayer: false, rawType: "cast" });

async function main() {
  server = http.createServer((request, response) => {
    const root = path.join(clientRoot, "dist");
    const name = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(root, name === "/" ? "index.html" : `.${name}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.exposeFunction("__WCL_NATIVE__", async (command, args) => {
    if (command === "get_cloud_settings") return { endpoint: "http://127.0.0.1:18000", teamId: "team", deviceId: "fixture", hasToken: true, connectionKey: "fixture-connection", identity: { userId: "user", displayName: "测试用户", teams: [{ teamId: "team", name: "测试团队", role: "leader" }] } };
    if (command === "get_cloud_uploads" || command === "list_local_recordings" || command === "get_spell_metadata") return [];
    if (command === "get_cloud_replay_annotations") return { version: 0, items: [], canEdit: true };
    if (command === "list_cloud_replays") return [{ ...clone(base), timelineRevision: wcl.revision, timelineComplete: Boolean(wcl.revision), timelineEventCount: wcl.eventCount }];
    if (command === "get_cloud_wcl_status") {
      calls.status++;
      assert.equal(args.pullId, pullId);
      if (wcl.status === "pending" && ++pendingPolls >= 2) Object.assign(wcl, { status: "ready", revision: "snapshot-one", eventCount: 2, actors: clone(actors) });
      return clone(wcl);
    }
    if (command === "start_cloud_wcl_import") {
      calls.starts.push(clone(args));
      assert.equal(args.pullId, pullId);
      if (failImport) { Object.assign(wcl, { status: "failed", error: "报告暂时不可用，保留旧版" }); return clone(wcl); }
      Object.assign(wcl, { status: "pending", reportCode: args.request.reportCode, fightId: args.request.fightId, actorBindings: clone(args.request.actorBindings), error: null });
      pendingPolls = 0;
      return clone(wcl);
    }
    if (command === "list_cloud_replay_events") {
      calls.events.push(clone(args));
      assert.equal(args.pullId, recordId);
      // 空的非末页也必须继续；每页有独立游标，完整读取后再显示筛选。
      if (!args.cursor) return { revision: wcl.revision, events: [], total: 2, nextCursor: "page-two", hasMore: true, reset: true };
      return { revision: wcl.revision, events: args.cursor === "page-two" ? [event(1, 4000), event(2, 6000)] : [], total: 2, nextCursor: "end", hasMore: false, reset: false };
    }
    if (command === "list_replay_events") { calls.localEvents++; throw new Error("云事件不得读取本地索引"); }
    return null;
  });
  await page.addInitScript(({ defaults, recordId }) => {
    let callback = 0;
    const prefs = { selectedPullId: recordId, catalogSource: "team", bookmarksMs: {}, offsetsMs: {}, volume: 1, muted: true, playbackRate: 1, eventKinds: [], actorGuid: null, timelineTrackHeight: 30, timelineIconPercent: 80, timelineZoom: 1, timelineTrackOverrides: {}, customTimelineTracks: [] };
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, transformCallback: () => ++callback, unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command === "get_replay_preferences") return structuredClone(prefs);
        if (command === "set_replay_preferences") { Object.assign(prefs, args.preferences); return; }
        if (command === "get_obs_status") return defaults.disconnectedObsStatus;
        if (command === "get_obs_installation") return defaults.defaultInstallationStatus;
        if (command === "get_cached_obs_settings" || command === "get_live_session") return null;
        if (command === "get_recording_import_preferences") return { directory: "", logPaths: [] };
        if (command === "get_recording_import") return { status: "idle", taskId: null, totalRecordings: 0, processedRecordings: 0, importedCount: 0, skippedCount: 0, failedCount: 0, bytesRead: 0, totalBytes: 0, currentFile: null, error: null, issues: [], pullIds: [] };
        if (command === "plugin:event|listen") return ++callback;
        if (command === "plugin:window|is_maximized") return false;
        if (command.startsWith("plugin:")) return;
        return window.__WCL_NATIVE__(command, args);
      } };
  }, { defaults: { disconnectedObsStatus: defaults.disconnectedObsStatus, defaultInstallationStatus: defaults.defaultInstallationStatus }, recordId });
  await page.route("http://cloud-replay.localhost/**", async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    assert.match(file, /^(index\.m3u8|init\.mp4|segment-\d{5}\.m4s)$/);
    await route.fulfill({ path: path.join(path.dirname(fixture.playbackPath), file), contentType: file.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  const run = async (name, task) => { await task(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
  const dialog = () => page.getByRole("dialog", { name: "关联标准战斗事件" });
  const close = async () => {
    await dialog().getByRole("button", { name: "Close", exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
  };
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "回放", exact: true }).click();
  await page.getByText("等待标准战斗事件", { exact: true }).waitFor();
  await run("未打开标准事件面板不请求WCL，录像正常加载", async () => {
    assert.equal(calls.status, 0);
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  });
  await run("无应用凭证明确禁用导入，录像不受影响", async () => {
    await page.getByRole("button", { name: "标准事件", exact: true }).click();
    await page.getByText("服务器尚未配置 WCL 应用凭证", { exact: true }).waitFor();
    assert.equal(await dialog().getByRole("button", { name: "导入标准事件", exact: true }).isDisabled(), true);
    await close();
  });
  wcl.configured = true;
  await run("官方报告链接提取fight，拒绝外域且不提交", async () => {
    await page.getByRole("button", { name: "标准事件", exact: true }).click();
    await page.waitForFunction(() => !document.body.innerText.includes("服务器尚未配置 WCL 应用凭证"));
    await page.getByLabel("WCL 报告链接或代码", { exact: true }).fill("https://evil.test/reports/abcdefghijklmnop");
    assert.equal(await dialog().getByRole("button", { name: "导入标准事件", exact: true }).isDisabled(), true);
    assert.equal(calls.starts.length, 0);
    await page.getByLabel("WCL 报告链接或代码", { exact: true }).fill("https://cn.warcraftlogs.com/reports/abcdefghijklmnop#fight=4");
    assert.equal(await page.getByLabel("战斗编号 fight", { exact: true }).inputValue(), "4");
  });
  await run("显式提交并轮询，完整发布后经云事件分页读取", async () => {
    await dialog().getByRole("button", { name: "导入标准事件", exact: true }).click();
    await page.getByText("标准事件已就绪", { exact: true }).waitFor({ timeout: 12000 });
    assert.deepEqual(calls.starts[0].request, { reportCode: "abcdefghijklmnop", fightId: 4, refresh: false, actorBindings: [] });
    await close();
    await page.getByRole("button", { name: /WCL盾甲 施法成功/ }).waitFor();
    assert.deepEqual(calls.events.slice(0, 2).map((item) => item.cursor), [null, "page-two"]);
    assert.equal(calls.localEvents, 0);
  });
  await run("同名WCL人物有独立筛选身份，事件按原时刻回看", async () => {
    await page.locator("video").evaluate((video) => video.pause());
    await page.getByRole("button", { name: /WCL盾甲 施法成功/ }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 3) < 0.2);
    await page.getByRole("combobox", { name: "筛选事件人物" }).click();
    const options = page.locator(".ant-select-item-option-content").filter({ hasText: "同名WCL角色" });
    assert.equal(await options.count(), 2);
    await options.first().click();
    assert.equal(await page.getByRole("button", { name: /WCL盾甲 施法成功/ }).count(), 1);
    assert.equal(await page.getByRole("button", { name: /WCL盾乙 施法成功/ }).count(), 0);
  });
  await run("显式人物绑定与重新导入参数，失败保留已发布事件", async () => {
    await page.getByRole("button", { name: "标准事件", exact: true }).click();
    await page.getByRole("combobox", { name: "WCL人物绑定测试视角" }).click();
    await page.getByText("同名WCL角色 · Paladin · #1", { exact: true }).click();
    failImport = true;
    await dialog().getByRole("button", { name: "重新导入并应用人物绑定", exact: true }).click();
    await page.getByText("本次报告导入未完成", { exact: true }).waitFor();
    assert.equal(calls.starts[1].request.refresh, true);
    assert.deepEqual(calls.starts[1].request.actorBindings, [{ recordingId: recordId, actorId: 1 }]);
    await close();
    assert.equal(await page.getByRole("button", { name: /WCL盾甲 施法成功/ }).count(), 1);
  });
  await run("面板关闭及终态停止轮询，没有重复导入", async () => {
    const count = calls.status;
    await page.waitForTimeout(2300);
    assert.equal(calls.status, count);
    assert.equal(calls.starts.length, 2);
  });
  await page.screenshot({ path: path.join(output, "wcl-timeline.png"), fullPage: true });
  assert.deepEqual(report.pageErrors, []);
  report.calls = calls;
}

main().catch(async (error) => {
  report.error = error.stack; process.exitCode = 1; console.error(error);
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
    report.failureSelects = await page.locator(".ant-select-dropdown").evaluateAll((elements) => elements.map((element) => ({ text: element.textContent, classes: element.className, bounds: element.getBoundingClientRect().toJSON() })));
  }
}).finally(async () => {
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
