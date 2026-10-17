const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { waitUntil, processExited } = require("./wait-until.cjs");
const { createCloudDeathFixture, verifyCloudDeath } = require("./review/native-cloud-death.cjs");
const { verifyNativeCloudDrag } = require("./timeline/native-cloud-drag.cjs");

// 真实 Tauri / DPAPI / WebView2；云服务仅为本机 HTTP 夹具，媒体全部为合成测试图。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const executable = path.resolve(argument("--exe"));
const fixture = JSON.parse(fs.readFileSync(path.join(argument("--fixture"), "fixture.json"), "utf8"));
const playwright = require(path.resolve(argument("--playwright")));
const appId = "com.wow.recorder.cloudvalidation20261017";
const roaming = path.join(process.env.APPDATA, appId);
const team = "11111111-1111-4111-8111-111111111111";
const otherTeam = "99999999-9999-4999-8999-999999999999";
const battle = "22222222-2222-4222-8222-222222222222";
const version = "33333333-3333-4333-8333-333333333333";
const ids = ["44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666", "88888888-8888-4888-8888-888888888888"];
const tokens = ["native-test-only-token-a", "native-test-only-token-b"];
const withDeathReview = process.argv.includes("--death-review");
const deathFixture = withDeathReview ? createCloudDeathFixture({ ids }) : null;
const identity = { userId: "77777777-7777-4777-8777-777777777777", displayName: "原生云端测试用户", teams: [{ teamId: team, name: "原生测试团队", role: "leader" }, { teamId: otherTeam, name: "另一测试团队", role: "member" }] };
const players = ["视角甲", "视角乙", "处理中的成员", "缺片成员"].map((name, index) => ({ actorId: index + 1, guid: `Player-Cloud${index}`, name, serverName: "测试服务器", fullType: "Hunter-Marksmanship" }));
const mediaDirectory = path.join(path.dirname(path.normalize(fixture.videoPath)), "hls");
const records = ids.map((id, index) => ({ teamId: team, teamPullId: battle, recordingId: id, encounterId: 7001, encounterName: "原生团队测试首领", difficultyId: 16,
  encounterStartUnixMs: fixture.encounterStartUnixMs, encounterEndUnixMs: fixture.encounterEndUnixMs, characterGuid: players[index].guid, characterName: players[index].name,
  status: index === 2 ? "processing" : "ready", videoZeroMs: index === 1 ? 4000 : 2000, videoDurationMs: fixture.mapping.mediaDurationMs,
  players, intervals: [], hasGap: index === 3, clockDiscontinuous: false, mediaCalibrated: false, calibrationError: "合成夹具估算偏移", processingError: null,
  playbackVersion: index === 2 ? null : version, success: false, groupSize: 4,
}));
const report = { cases: [], pageErrors: [], boundary: "独立应用标识；真实 Rust IPC / DPAPI / WebView2 / cloud-replay 协议；本机假 HTTP 服务与合成媒体；未连接真实 PostgreSQL/S3，未上传真实录像" };
report.forcedStops = 0;
const backups = [];
if (withDeathReview) for (const record of records) Object.assign(record, { timelineRevision: "events-schema-2", timelineEventCount: 6, timelineComplete: true });
const requests = [];
let child, browser, page, server, origin, playlistMode = "valid";

async function listen(service) { await new Promise((resolve) => service.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${service.address().port}`; }
async function port() { const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve)); const result = socket.address().port; await new Promise((resolve) => socket.close(resolve)); return result; }
async function invoke(command, args) { return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args }); }
async function fetchNative(url, method = "GET") { return page.evaluate(async ({ url, method }) => { const response = await fetch(url, { method }); return { status: response.status, bytes: (await response.arrayBuffer()).byteLength, mime: response.headers.get("content-type") }; }, { url, method }); }
async function pauseAndLeave() { await page.locator("video").evaluateAll((videos) => videos.forEach((video) => video.pause())); await page.getByRole("navigation").getByRole("button", { name: "个人中心" }).click(); }

async function launch() {
  const debugPort = await port();
  report.debugPort = debugPort;
  child = spawn(path.join(output, "app/wow-recorder-client.exe"), [], { windowsHide: !process.argv.includes("--windows-mouse"), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --disable-background-timer-throttling --force-renderer-accessibility` } });
  child.stdout.on("data", (data) => fs.appendFileSync(path.join(output, "stdout.log"), data));
  child.stderr.on("data", (data) => fs.appendFileSync(path.join(output, "stderr.log"), data));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  assert.ok(browser, "WebView2 调试端点未就绪");
  const context = browser.contexts()[0]; page = context.pages()[0] || await context.waitForEvent("page");
  page.on("pageerror", (failure) => report.pageErrors.push(failure.message));
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && document.querySelector("nav"));
  assert.equal(await invoke("plugin:app|identifier"), appId, "禁止操作正式用户应用");
}

async function close() {
  if (page && !page.isClosed()) await invoke("plugin:window|close", { label: "main" }).catch(() => {});
  if (child && !processExited(child)) {
    const stopped = () => processExited(child);
    try { await waitUntil(async () => stopped(), Boolean, "原生云端验收正常退出"); }
    catch { report.forcedStops++; child.kill(); await waitUntil(async () => stopped(), Boolean, "原生验收进程退出"); }
  }
  browser = null; page = null;
}

async function main() {
  assert.ok(fs.readFileSync(executable).includes(Buffer.from(appId)), "先使用独立云验收标识构建，禁止启动正式程序");
  assert.equal(fixture.pullId, "0000000000000000000000000000000000000000000000000000000000000001", "只允许显式生成的合成测试夹具");
  assert.ok(fs.existsSync(path.join(mediaDirectory, "index.m3u8")), "缺少合成 HLS 夹具");
  fs.mkdirSync(path.join(output, "app"), { recursive: true });
  fs.copyFileSync(executable, path.join(output, "app/wow-recorder-client.exe"));
  fs.mkdirSync(roaming, { recursive: true });
  fs.mkdirSync(path.join(output, "backup"), { recursive: true });
  for (const name of ["recording-index.json", "client-state.json"]) {
    const file = path.join(roaming, name), bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
    backups.push({ file, bytes }); if (bytes) fs.writeFileSync(path.join(output, "backup", name), bytes);
  }
  fs.writeFileSync(path.join(roaming, "recording-index.json"), JSON.stringify({ schemaVersion: 2, activePull: null, pulls: [], sources: [], diagnostics: [] }));
  fs.writeFileSync(path.join(roaming, "client-state.json"), JSON.stringify({ schemaVersion: 1, sections: { replay: { catalogSource: "team", selectedPullId: ids[0], bookmarksMs: { [ids[0]]: 3000 }, offsetsMs: {}, muted: true, volume: 0.5, playbackRate: 1, eventKinds: [], actorGuid: null }, validationSentinel: { preserve: true } } }));
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const authOk = tokens.some((token) => request.headers.authorization === `Bearer ${token}`);
    requests.push({ path: url.pathname, authOk, method: request.method });
    if (!authOk) { response.writeHead(401).end(); return; }
    if (deathFixture?.respond(url, response)) return;
    if (url.pathname === "/api/v1/me") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(identity)); return; }
    if (url.pathname === `/api/v1/teams/${team}/recordings`) {
      const offset = Number(url.searchParams.get("offset")), limit = Number(url.searchParams.get("limit"));
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) { response.writeHead(400).end(); return; }
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(records.slice(offset, offset + limit))); return;
    }
    if (url.pathname === `/api/v1/teams/${otherTeam}/recordings`) { response.setHeader("Content-Type", "application/json"); response.end("[]"); return; }
    if (ids.some((id) => url.pathname === `/api/v1/teams/${team}/recordings/${id}/events`)) {
      const types = [["refreshbuff", "buffRefresh"], ["refreshdebuff", "debuffRefresh"], ["empowerstart", "empowerStart"], ["empowerend", "empowerEnd"], ["resurrect", "resurrect"]];
      const events = types.map(([rawType, kind], index) => ({ eventId: `wcl:AbCdEfGh12345678:${index}`, pullTimeMs: index * 1000,
        owner: "player", kind, sourceName: "标准来源", sourceGuid: "", targetName: "标准目标", targetGuid: "",
        spellId: 17, spellName: "标准技能", stackCount: null, extraSpellId: null, empowerLevel: kind === "empowerEnd" ? 3 : null,
        identityNamespace: "wcl:AbCdEfGh12345678", sourceActorId: 1, targetActorId: 2, sourceIsPlayer: true, targetIsPlayer: true, rawType }));
      if (deathFixture) events.push(deathFixture.death);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ revision: "events-schema-2", total: events.length, events, nextCursor: "end", hasMore: false, reset: false })); return;
    }
    const annotations = url.pathname.match(/^\/api\/v1\/teams\/([^/]+)\/recordings\/([^/]+)\/annotations$/);
    if (request.method === "GET" && annotations && annotations[1] === team && ids.includes(annotations[2])) {
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ version: 0, items: [], canEdit: true })); return;
    }
    const media = url.pathname.match(/^\/api\/v1\/teams\/([^/]+)\/recordings\/([^/]+)\/media\/([^/]+)$/);
    if (media && media[1] === team && ids.slice(0, 2).includes(media[2]) && url.searchParams.get("version") === version) {
      const file = media[3];
      if (!/^(index\.m3u8|init\.mp4|segment-\d{5}\.m4s)$/.test(file)) { response.writeHead(400).end(); return; }
      if (file === "index.m3u8" && playlistMode !== "valid") {
        response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        response.end(playlistMode === "external" ? "#EXTM3U\n#EXTINF:4,\nhttps://unreachable.invalid/segment-00000.m4s\n" : '#EXTM3U\n#EXT-X-MAP:URI="../init.mp4"\n#EXTINF:4,\nsegment-00000.m4s\n'); return;
      }
      const filePath = path.join(mediaDirectory, file);
      if (!fs.existsSync(filePath)) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Type", file.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4");
      fs.createReadStream(filePath).pipe(response); return;
    }
    response.writeHead(404).end();
  });
  origin = await listen(server);
  const run = async (name, action) => { await action(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
  let listed, currentUrl;
  try {
    await launch();
    await run("真实原生连接验证、DPAPI密文落盘和个人中心身份", async () => {
      const initial = await invoke("get_cloud_settings"); assert.equal(initial.hasToken, false); assert.equal(initial.identity, null);
      await invoke("set_cloud_settings", { settings: { endpoint: origin, teamId: team, token: tokens[0] } });
      await invoke("verify_cloud_connection");
      const settings = await invoke("get_cloud_settings"); assert.equal(settings.hasToken, true); assert.deepEqual(settings.identity, identity);
      assert.equal(settings.connectionKey.length, 64); assert.equal(Object.hasOwn(settings, "token"), false); assert.equal(Object.hasOwn(settings, "protectedToken"), false);
      const saved = fs.readFileSync(path.join(roaming, "client-state.json"), "utf8"); assert.ok(!tokens.some((token) => saved.includes(token)));
      assert.ok(JSON.parse(saved).sections.cloud.protectedToken.length > 0); assert.equal(JSON.parse(saved).sections.validationSentinel.preserve, true);
      await page.getByRole("navigation").getByRole("button", { name: "个人中心" }).click();
      await page.getByRole("heading", { name: identity.displayName }).waitFor();
      await page.getByText("原生测试团队", { exact: true }).first().waitFor();
    });
    await run("真实团队目录规范化、有符号映射与处理状态边界", async () => {
      listed = await invoke("list_cloud_replays", { offset: 0, limit: 100 }); assert.equal(listed.length, 4);
      assert.equal(listed[0].mapping.videoZeroMs, 2000); assert.equal(listed[1].mapping.videoZeroMs, 4000);
      assert.equal(listed[0].battleKey, listed[1].battleKey); assert.equal(listed[2].state, "processing"); assert.equal(listed[2].playbackUrl, null);
      assert.equal(listed[0].sourceKind, "cloud"); assert.equal(listed[0].videoPath, null); currentUrl = listed[0].playbackUrl;
      assert.equal(listed[3].mapping.hasGap, true); assert.equal(listed[3].mapping.mediaCalibrated, false); assert.deepEqual(listed[3].mapping.intervals, []);
      let rejected = false; try { await invoke("list_cloud_replays", { offset: 0, limit: 101 }); } catch { rejected = true; } assert.equal(rejected, true);
    });
    await run("真实原生WCL分页接受刷新蓄力复活，保留等级与报告人物身份", async () => {
      const result = await invoke("list_cloud_replay_events", { pullId: ids[0], cursor: null, limit: 100 });
      assert.deepEqual(result.events.map((item) => item.kind), ["buffRefresh", "debuffRefresh", "empowerStart", "empowerEnd", "resurrect", ...(withDeathReview ? ["death"] : [])]);
      assert.equal(result.events[3].empowerLevel, 3); assert.equal(result.events[4].empowerLevel, null);
      assert.equal(result.events[4].targetActorId, 2);
      assert.ok(result.events.every((item) => item.sourceGuid === "" && item.identityNamespace === "wcl:AbCdEfGh12345678"));
      assert.equal(result.total, withDeathReview ? 6 : 5); assert.equal(result.hasMore, false);
    });
    await run("真实团队界面HLS播放、暂停切换视角保持战斗时间", async () => {
      await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
      await page.getByRole("button", { name: "观看视角甲视角", exact: true }).waitFor();
      await page.waitForFunction(() => { const video = document.querySelector("video[aria-label$='团队回放']"); return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 5) < 0.2; });
      assert.equal(await page.getByRole("button", { name: "观看处理中的成员视角" }).isDisabled(), true);
      await page.getByRole("button", { name: "观看视角乙视角", exact: true }).click();
      await page.waitForFunction(() => { const video = document.querySelector("video[aria-label$='团队回放']"); return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 7) < 0.2 && video.paused; });
      assert.equal(requests.some((request) => request.path.includes(`/recordings/${ids[2]}/media/`)), false);
      await page.getByRole("button", { name: "观看缺片成员视角", exact: true }).click();
      await page.getByText("该人物的录像尚不可播放或不覆盖当前战斗时间，已保留当前视角。", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "观看视角乙视角", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(requests.some((request) => request.path.includes(`/recordings/${ids[3]}/media/`)), false);
      await page.screenshot({ path: path.join(output, "native-team.png"), fullPage: true });
    });
    await run("播放中切换视角保持播放意图并继续推进", async () => {
      const video = page.locator("video[aria-label$='团队回放']"); await video.evaluate((element) => { element.muted = true; return element.play(); });
      await page.waitForFunction(() => document.querySelector("video[aria-label$='团队回放']").currentTime > 7.3);
      const battleTime = await video.evaluate((element) => element.currentTime - 4);
      await page.getByRole("button", { name: "观看视角甲视角", exact: true }).click();
      await page.waitForFunction((expected) => { const video = document.querySelector("video[aria-label$='团队回放']"); return video?.readyState >= 2 && !video.paused && video.currentTime >= expected && video.currentTime < expected + 1; }, battleTime + 2);
      await page.locator("video[aria-label$='团队回放']").evaluate((element) => element.pause());
      await page.setViewportSize({ width: 1080, height: 720 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: path.join(output, "native-team-1080.png"), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      report.viewports = ["1440x900", "1080x720"];
      await pauseAndLeave();
    });
    if (process.argv.includes("--drag-trace")) await verifyNativeCloudDrag({ page, invoke, run, report, manual: process.argv.includes("--manual-drag"), windowsMouse: process.argv.includes("--windows-mouse"), output, nativePid: child.pid, debugPort: report.debugPort });
    if (deathFixture) {
      await verifyCloudDeath({ page, invoke, run, fixture: deathFixture, origin, team, ids, tokens, output });
      // 换凭证会正确撤销先前媒体URL，后续协议检查必须使用当前凭证重新签发的地址。
      listed = await invoke("list_cloud_replays", { offset: 0, limit: 100 }); currentUrl = listed[0].playbackUrl;
    }
    await run("云端清单外链与跨路径引用被真实协议拒绝", async () => {
      playlistMode = "external"; assert.ok((await fetchNative(currentUrl)).status >= 400);
      playlistMode = "traversal"; assert.ok((await fetchNative(currentUrl)).status >= 400); playlistMode = "valid";
      const before = requests.length;
      assert.equal((await fetchNative(currentUrl.replace(ids[0], "invalid-id"))).status, 400);
      assert.equal((await fetchNative(`${currentUrl}?secret=not-allowed`)).status, 400);
      assert.equal((await fetchNative(currentUrl.replace("index.m3u8", "..%2Fclient-state.json"))).status, 400);
      assert.equal(requests.length, before);
      const head = await fetchNative(currentUrl.replace("index.m3u8", "init.mp4"), "HEAD"); assert.equal(head.status, 200); assert.equal(head.bytes, 0);
    });
    await run("令牌轮换使旧URL失效且不会向服务端转发", async () => {
      const previous = await invoke("get_cloud_settings");
      await invoke("set_cloud_settings", { settings: { endpoint: origin, teamId: team, token: tokens[1] } });
      const changed = await invoke("get_cloud_settings"); assert.notEqual(changed.connectionKey, previous.connectionKey);
      const before = requests.length; assert.ok((await fetchNative(currentUrl)).status >= 400); assert.equal(requests.length, before);
      listed = await invoke("list_cloud_replays", { offset: 0, limit: 100 }); currentUrl = listed[0].playbackUrl; assert.equal((await fetchNative(currentUrl)).status, 200);
    });
    await run("进程重启只恢复密文配置，身份需服务端重新验证", async () => {
      await close(); await launch(); const restored = await invoke("get_cloud_settings"); assert.equal(restored.hasToken, true); assert.equal(restored.identity, null);
      assert.deepEqual(await invoke("verify_cloud_connection"), identity); listed = await invoke("list_cloud_replays", { offset: 0, limit: 100 }); currentUrl = listed[0].playbackUrl;
      assert.equal((await fetchNative(currentUrl)).status, 200);
    });
    await run("换团队与换服务器撤销旧媒体URL且清除旧域令牌", async () => {
      await invoke("set_cloud_settings", { settings: { endpoint: origin, teamId: otherTeam } });
      let before = requests.length; assert.ok((await fetchNative(currentUrl)).status >= 400); assert.equal(requests.length, before);
      await invoke("set_cloud_settings", { settings: { endpoint: `http://127.0.0.1:${await port()}`, teamId: null } });
      const disconnected = await invoke("get_cloud_settings"); assert.equal(disconnected.hasToken, false); assert.equal(disconnected.identity, null);
      before = requests.length; assert.ok((await fetchNative(currentUrl)).status >= 400); assert.equal(requests.length, before);
    });
    assert.ok(requests.some((request) => request.path.endsWith(".m4s"))); assert.ok(requests.every((request) => request.authOk)); assert.deepEqual(report.pageErrors, []);
    report.requests = { total: requests.length, media: requests.filter((request) => request.path.includes("/media/")).length, allAuthenticated: true, source: "127.0.0.1 synthetic HTTP fixture" }; report.passed = true;
  } catch (failure) {
    report.passed = false; report.failure = String(failure.stack || failure); if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {}); throw failure;
  } finally {
    try { deathFixture?.release(); await close(); }
    finally {
      await new Promise((resolve) => server.close(resolve));
      for (const backup of backups) { if (backup.bytes) fs.writeFileSync(backup.file, backup.bytes); else if (fs.existsSync(backup.file)) fs.unlinkSync(backup.file); }
    }
    report.isolatedStateRestored = backups.every((backup) => backup.bytes ? fs.readFileSync(backup.file).equals(backup.bytes) : !fs.existsSync(backup.file));
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    assert.equal(report.forcedStops, 0); assert.equal(report.isolatedStateRestored, true);
  }
}
main().catch((failure) => { console.error(failure); process.exitCode = 1; });
