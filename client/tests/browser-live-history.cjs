const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { loadSource } = require("./source-loader.cjs");

// 运行真实 MediaMTX、WebRTC、HLS.js 和 H.264/Opus；Tauri IPC 仅转接到独立测试媒体节点。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const recordingFixture = JSON.parse(fs.readFileSync(path.join(argument("--fixture"), "fixture.json"), "utf8"));
const source = recordingFixture.videoPath;
const playwright = require(path.resolve(argument("--playwright")));
const clientRoot = path.resolve(__dirname, "..");
const defaults = loadSource("src/features/obs/model.ts");
const report = { cases: [], pageErrors: [], boundary: "真实 MediaMTX/WebRTC/HLS；IPC 为测试节点适配，不替代 OBS WHIP 实机验收" };
const children = [];
const resources = new Map();
let browser, page, server;
let negotiated = 0, released = 0;
let activeBattle = null;
let recentBattles = [];
const battleEvents = new Map();
let archiveRecording = null;
let mediaGate = null;
let releaseMedia = null;
fs.mkdirSync(output, { recursive: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() { const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve)); const value = socket.address().port; await new Promise((resolve) => socket.close(resolve)); return value; }
function start(exe, args, name) {
  const stream = fs.openSync(path.join(output, `${name}.log`), "w");
  const child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", stream, stream] });
  children.push(child); child.on("error", (error) => console.error(error)); return child;
}

async function main() {
  const hlsPort = await port(), rtspPort = await port(), whepPort = await port(), udpPort = await port();
  const origin = `http://127.0.0.1:${hlsPort}/wow-recorder`;
  const whep = `http://127.0.0.1:${whepPort}/wow-recorder/whep`;
  const configuration = `logLevel: warn\napi: false\nmetrics: false\npprof: false\nplayback: false\nrtsp: true\nrtspAddress: 127.0.0.1:${rtspPort}\nrtspTransports: [tcp]\nrtmp: false\nsrt: false\nhls: true\nhlsAddress: 127.0.0.1:${hlsPort}\nhlsAlwaysRemux: true\nhlsVariant: fmp4\nhlsSegmentCount: 10\nhlsSegmentDuration: 2s\nwebrtc: true\nwebrtcAddress: 127.0.0.1:${whepPort}\nwebrtcLocalUDPAddress: 127.0.0.1:${udpPort}\nwebrtcIPsFromInterfaces: false\nwebrtcAdditionalHosts: [127.0.0.1]\npaths:\n  wow-recorder:\n    source: publisher\n`;
  fs.writeFileSync(path.join(output, "mediamtx.yml"), configuration);
  const session = { sessionId: randomUUID(), startedAtUnixMs: Date.now(), recordingActive: true, iceServers: [] };
  start(path.join(clientRoot, "src-tauri/resources/media-runtime/mediamtx.exe"), [path.join(output, "mediamtx.yml")], "server");
  await delay(500);
  start(path.join(clientRoot, "src-tauri/resources/ffmpeg-runtime/bin/ffmpeg.exe"), ["-hide_banner", "-loglevel", "error", "-re", "-stream_loop", "-1", "-i", source, "-c:v", "copy", "-c:a", "libopus", "-f", "rtsp", "-rtsp_transport", "tcp", `rtsp://127.0.0.1:${rtspPort}/wow-recorder`], "publisher");
  console.log("已启动独立真实媒体节点，等待历史窗口积累");
  const history = async () => {
    const master = await (await fetch(`${origin}/index.m3u8`)).text();
    fs.writeFileSync(path.join(output, "latest-master.m3u8"), master);
    const mediaFile = master.split(/\r?\n/).find((line) => line && !line.startsWith("#"));
    const media = await (await fetch(`${origin}/${mediaFile}`)).text();
    fs.writeFileSync(path.join(output, "latest-media.m3u8"), media);
    let time = null, duration = null, elapsed = 0; const raw = [];
    for (const line of media.split(/\r?\n/)) {
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) time = line.slice(25);
      else if (line.startsWith("#EXTINF:")) duration = Number(line.slice(8).split(",")[0]);
      else if (line && !line.startsWith("#")) { if (duration) raw.push({ file: line, programDateTime: time, durationSeconds: duration, discontinuity: false, elapsed }); elapsed += duration ?? 0; time = null; duration = null; }
    }
    let previous = null;
    const segments = raw.flatMap((segment) => {
      if (segment.programDateTime) previous = segment;
      const anchor = previous ?? raw.find((entry) => entry.programDateTime);
      return anchor ? [{ ...segment, programDateTime: anchor.programDateTime, programDateTimeOffsetSeconds: segment.elapsed - anchor.elapsed }] : [];
    });
    if (segments.length < 2) throw new Error("历史分片正在生成");
    return { sessionId: session.sessionId, sessionStartedAtUnixMs: session.startedAtUnixMs, playlistUrl: `http://live-history.localhost/${session.sessionId}/index.m3u8`, segments, activeBattle, recentBattles, timingBasis: "serverReceptionClock" };
  };
  const deadline = Date.now() + 40000;
  while (true) {
    try { const manifest = await history(); if (manifest.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0) >= 16) break; } catch {}
    assert.ok(Date.now() < deadline, "历史窗口未形成"); await delay(500);
  }
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const root = path.join(clientRoot, "dist"); const filename = path.resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(filename)] || "application/octet-stream");
    fs.createReadStream(filename).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.exposeFunction("__LIVE_NATIVE__", async (command, args) => {
    if (command === "get_live_session") return session;
    if (command === "get_live_replay_manifest") return history();
    if (command === "list_local_recordings") return archiveRecording ? [archiveRecording] : [];
    if (command === "get_spell_metadata") return [];
    if (command === "get_local_replay_annotations" || command === "get_cloud_replay_annotations") return { version: 0, items: [], canEdit: true };
    if (command === "list_replay_events") {
      const events = battleEvents.get(args.pullId) ?? [];
      return { revision: `${args.pullId}:1`, events: args.cursor ? [] : events, total: events.length, nextCursor: `${args.pullId}:end`, hasMore: false, reset: !args.cursor };
    }
    if (command === "negotiate_live_playback") {
      const response = await fetch(whep, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: args.offerSdp });
      assert.equal(response.status, 201); const playbackId = randomUUID(); negotiated++;
      resources.set(playbackId, new URL(response.headers.get("location"), whep).href);
      return { playbackId, answerSdp: await response.text() };
    }
    if (command === "release_live_playback") { const url = resources.get(args.playbackId); if (url) { await fetch(url, { method: "DELETE" }); resources.delete(args.playbackId); released++; } return; }
    return null;
  });
  await page.addInitScript(({ defaults }) => {
    let callback = 0; const preferences = { selectedPullId: null, bookmarksMs: {}, offsetsMs: {}, volume: 1, muted: true, playbackRate: 1, eventKinds: [], actorGuid: null, timelineTrackHeight: 30, timelineIconPercent: 80, timelineZoom: 1, timelineTrackOverrides: {} };
    window.__LIVE_TEST__ = { liveActive: true, peers: [] };
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args) { super(...args); window.__LIVE_TEST__.peers.push(this); }
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, transformCallback: () => ++callback, unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command === "get_obs_status") return { ...defaults.disconnectedObsStatus, connected: true, recordingActive: window.__LIVE_TEST__.liveActive, liveActive: window.__LIVE_TEST__.liveActive, liveReady: true, captureReady: true, readinessMessage: "直播中" };
        if (command === "get_replay_preferences") return preferences;
        if (command === "get_cloud_settings") return { endpoint: "", teamId: null, deviceId: "fixture-device", hasToken: false, identity: null, connectionKey: "" };
        if (command === "get_cloud_uploads") return [];
        if (command === "set_replay_preferences") { window.__LIVE_TEST__.savedPreferences = structuredClone(args.preferences); return; }
        if (command === "get_recording_import_preferences") return { directory: "", logPaths: [] };
        if (command === "get_recording_import") return { taskId: null, status: "idle", totalRecordings: 0, processedRecordings: 0, importedCount: 0, skippedCount: 0, failedCount: 0, bytesRead: 0, totalBytes: 0, currentFile: null, error: null, issues: [], pullIds: [] };
        if (command === "get_obs_installation") return defaults.defaultInstallationStatus;
        if (command === "get_obs_settings_snapshot") return { video: defaults.defaultVideoSettings, capture: defaults.defaultCaptureSettings, audioInputs: [] };
        if (command === "plugin:event|listen") return ++callback;
        if (command === "plugin:window|is_maximized") return false;
        return window.__LIVE_NATIVE__(command, args);
      },
    };
  }, { defaults: { disconnectedObsStatus: defaults.disconnectedObsStatus, defaultInstallationStatus: defaults.defaultInstallationStatus, defaultVideoSettings: defaults.defaultVideoSettings, defaultCaptureSettings: defaults.defaultCaptureSettings } });
  await page.route("http://live-history.localhost/**", async (route) => {
    const url = new URL(route.request().url()); const file = url.pathname.split("/").at(-1);
    try {
      if (mediaGate) await mediaGate;
      const response = await fetch(`${origin}/${file}${url.search}`);
      await route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "video/mp4", headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
    } catch { await route.fulfill({ status: 503, body: "历史节点不可用" }).catch(() => {}); }
  });
  await page.route("http://local-replay.localhost/**", async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({ path: path.join(path.dirname(recordingFixture.playbackPath), file), contentType: file.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  const run = async (name, test) => { await test(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
  const live = () => page.locator('video[aria-label="实时直播画面"]');
  const vod = () => page.locator('video[aria-label="直播历史回放"]');
  const eventButton = (name = "圣盾术") => page.getByRole("button", { name: new RegExp(`^${name} 施法成功`) });
  const liveReady = async () => page.waitForFunction(() => { const video = document.querySelector('video[aria-label="实时直播画面"]'); return video && video.readyState >= 2 && video.videoWidth > 0; });
  const resumeLive = async () => {
    await live().waitFor();
    await page.waitForFunction(() => document.querySelector('video[aria-label="实时直播画面"]')?.srcObject);
    await live().evaluate((video) => video.play());
    await liveReady();
  };
  const vodReady = async () => page.waitForFunction(() => { const video = document.querySelector('video[aria-label="直播历史回放"]'); return video && video.readyState >= 2 && !video.seeking; });
  const waitNative = async (predicate) => {
    const deadline = Date.now() + 10000;
    while (!predicate()) { assert.ok(Date.now() < deadline, "原生资源状态等待超时"); await delay(50); }
  };
  const installBattle = async (label = "测试首领") => {
    const manifest = await history();
    const last = manifest.segments.at(-1);
    const end = Date.parse(last.programDateTime) + (last.programDateTimeOffsetSeconds ?? 0) * 1000 + last.durationSeconds * 1000;
    const id = randomUUID();
    activeBattle = { pullId: id, encounterName: label, startedAtUnixMs: end - 16000, endedAtUnixMs: null, eventCount: 2, eventRevision: `${id}:1`, playerName: "测试角色", indexComplete: false };
    battleEvents.set(id, [
      { eventId: `${id}:1`, owner: "player", kind: "castSuccess", sourceGuid: "Player-1", sourceName: "测试角色", targetGuid: "Player-1", targetName: "测试角色", spellId: 642, spellName: "圣盾术", pullTimeMs: 6000, stackCount: null, extraSpellId: null },
      { eventId: `${id}:2`, owner: "player", kind: "castSuccess", sourceGuid: "Player-1", sourceName: "测试角色", targetGuid: "Player-1", targetName: "测试角色", spellId: 17, spellName: "真言术：盾", pullTimeMs: 8000, stackCount: null, extraSpellId: null },
    ]);
    await page.getByText(`${label} · 进行中`, { exact: true }).waitFor();
    await eventButton().waitFor();
    return activeBattle;
  };
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("navigation").getByRole("button", { name: /直播/ }).click();
    await run("真实 WebRTC 首帧及历史窗口可用", async () => {
      await page.waitForFunction(() => { const video = document.querySelector('video[aria-label="实时直播画面"]'); return video && video.readyState >= 2 && video.videoWidth > 0; });
      assert.ok(negotiated > 0);
      await page.getByRole("slider", { name: "直播历史时间" }).waitFor();
    });
    await run("真实 RTC 会话中断后历史控件保留且 HLS 继续播放", async () => {
      await waitNative(() => resources.size === 1);
      const before = negotiated;
      const response = await fetch([...resources.values()][0], { method: "DELETE" });
      assert.equal(response.ok, true);
      await page.getByText("实时直播连接失败", { exact: true }).waitFor({ timeout: 20000 });
      assert.equal(await page.getByRole("slider", { name: "直播历史时间" }).isVisible(), true);
      const slider = page.getByRole("slider", { name: "直播历史时间" });
      const bounds = await slider.locator("..").boundingBox();
      await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2);
      await vodReady();
      assert.ok(await vod().evaluate((video) => video.videoWidth > 0));
      const first = await vod().evaluate(async (video) => { await video.play(); return video.currentTime; });
      await page.waitForFunction((time) => document.querySelector('video[aria-label="直播历史回放"]').currentTime > time + 0.25, first);
      await page.getByRole("button", { name: "返回直播", exact: true }).click();
      await resumeLive();
      assert.ok(negotiated > before);
    });
    await run("真实 RTC 中断可显式重试 LIVE 且不销毁历史窗口", async () => {
      await waitNative(() => resources.size === 1);
      const before = negotiated;
      const response = await fetch([...resources.values()][0], { method: "DELETE" });
      assert.equal(response.ok, true);
      await page.getByRole("button", { name: "重试直播", exact: true }).waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "重试直播", exact: true }).click();
      await liveReady();
      await page.waitForFunction(() => !document.querySelector('video[aria-label="实时直播画面"]').paused);
      await page.waitForFunction(() => !document.body.innerText.includes("实时直播连接失败"));
      assert.equal(await page.getByRole("slider", { name: "直播历史时间" }).isVisible(), true);
      assert.ok(negotiated > before);
      await page.screenshot({ path: path.join(output, "rtc-recovered.png"), fullPage: true });
    });
    await run("暂停状态切历史保留音量并解码 H.264/Opus", async () => {
      await live().evaluate((video) => { video.pause(); video.volume = 0.35; video.muted = true; });
      const slider = page.getByRole("slider", { name: "直播历史时间" });
      const bounds = await slider.locator("..").boundingBox();
      await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2);
      await page.waitForFunction(() => { const video = document.querySelector('video[aria-label="直播历史回放"]'); return video && video.readyState >= 2 && !video.seeking; });
      assert.deepEqual(await vod().evaluate((video) => [video.volume, video.muted, video.paused]), [0.35, true, true]);
      assert.ok(released > 0);
    });
    await run("返回 LIVE 保留暂停意图并恢复一倍速", async () => {
      await vod().evaluate((video) => { video.playbackRate = 1.5; });
      await page.getByRole("button", { name: "返回直播", exact: true }).click();
      await live().waitFor();
      await page.waitForFunction(() => { const video = document.querySelector('video[aria-label="实时直播画面"]'); return video && video.srcObject; });
      assert.deepEqual(await live().evaluate((video) => [video.volume, video.muted, video.playbackRate, video.paused]), [0.35, true, 1, true]);
      await live().evaluate((video) => video.play());
      await page.waitForFunction(() => document.querySelector('video[aria-label="实时直播画面"]').readyState >= 2);
    });
    await run("切页保留同一直播连接并临时静音", async () => {
      const before = negotiated;
      await live().evaluate((video) => { video.muted = false; });
      await page.getByRole("navigation").getByRole("button", { name: /首页/ }).click();
      assert.equal(await live().evaluate((video) => video.muted), true);
      await page.getByRole("navigation").getByRole("button", { name: /直播/ }).click();
      assert.equal(await live().evaluate((video) => video.muted), false);
      assert.equal(negotiated, before);
      await live().evaluate((video) => { video.muted = true; });
    });
    await run("暂停的历史片段被淘汰后明确提示", async () => {
      await live().evaluate((video) => video.pause());
      const slider = page.getByRole("slider", { name: "直播历史时间" });
      const bounds = await slider.locator("..").boundingBox();
      await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2);
      await vod().waitFor();
      await page.getByText("当前回看片段已过期，请选择仍在窗口内的时间或返回直播。", { exact: true }).waitFor({ timeout: 30000 });
      assert.equal(await vod().evaluate((video) => video.paused), true);
      await page.screenshot({ path: path.join(output, "expired-history.png"), fullPage: true });
    });
    await run("重复点击同一战斗事件重新定位且撤去过渡画面", async () => {
      await page.getByRole("button", { name: "返回直播", exact: true }).last().click();
      await resumeLive();
      await installBattle();
      await live().evaluate((video) => video.pause());
      await eventButton().click(); await vodReady();
      await page.getByText("战斗时间轴", { exact: true }).click();
      const first = await vod().evaluate((video) => video.currentTime);
      await vod().evaluate((video) => video.play());
      await page.waitForFunction((time) => document.querySelector('video[aria-label="直播历史回放"]').currentTime > time + 1, first);
      await vod().evaluate((video) => video.pause());
      await eventButton().click();
      await page.waitForFunction((time) => { const video = document.querySelector('video[aria-label="直播历史回放"]'); return video && !video.seeking && Math.abs(video.currentTime - time) < 0.15; }, first);
      await page.waitForFunction(() => !document.querySelector('img[alt="正在切换媒体"]'));
      assert.equal(await vod().evaluate((video) => video.paused), true);
    });
    await run("HLS 首帧前快速两次定位保留音量和播放意图", async () => {
      await page.getByRole("button", { name: "返回直播", exact: true }).click();
      await resumeLive();
      await installBattle("快速定位首领");
      await live().evaluate((video) => { video.volume = 0.25; video.muted = true; });
      mediaGate = new Promise((resolve) => { releaseMedia = resolve; });
      await eventButton().click(); await vod().waitFor();
      assert.equal(await vod().evaluate((video) => video.readyState), 0);
      await page.getByText("战斗时间轴", { exact: true }).click();
      await eventButton("真言术：盾").click();
      releaseMedia(); mediaGate = null; releaseMedia = null;
      await vodReady();
      await page.waitForFunction(() => !document.querySelector('video[aria-label="直播历史回放"]').paused);
      assert.deepEqual(await vod().evaluate((video) => [video.volume, video.muted]), [0.25, true]);
      await page.waitForFunction(() => { const current = document.querySelector('[aria-label="跳转到敌方技能时间"]'); return current && Number(current.getAttribute("aria-valuenow")) >= 4.8; });
      await vod().evaluate((video) => video.pause());
    });
    await run("LIVE 最右端不误报缺片也不保留静态过渡", async () => {
      await page.getByRole("button", { name: "返回直播", exact: true }).click();
      await resumeLive();
      await page.getByRole("slider", { name: "直播历史时间" }).press("End");
      assert.equal(await vod().count(), 0);
      assert.equal(await page.getByText("该时段没有已发布的历史录像，请选择其他时间或返回直播。", { exact: true }).count(), 0);
      await page.waitForFunction(() => !document.querySelector('img[alt="正在切换媒体"]'));
    });
    await run("结束战斗保留事件轴并支持选择历史战斗", async () => {
      const previous = await installBattle("已结束首领");
      previous.endedAtUnixMs = previous.startedAtUnixMs + 10000;
      previous.indexComplete = true;
      recentBattles = [previous]; activeBattle = null;
      await page.getByRole("combobox", { name: "直播回看战斗" }).waitFor();
      await page.getByText("已结束首领", { exact: false }).first().waitFor();
      await eventButton().waitFor();
      await page.waitForFunction(() => document.querySelector('[aria-label="跳转到敌方技能时间"]')?.getAttribute("aria-valuemax") === "10");
      assert.ok(Number(await page.getByRole("slider", { name: "跳转到敌方技能时间" }).getAttribute("aria-valuenow")) <= 10);
      await installBattle("新的进行中首领");
      await page.getByRole("combobox", { name: "直播回看战斗" }).click();
      await page.locator(".ant-select-dropdown").getByText("已结束首领 · 历史战斗 1", { exact: true }).click();
      await vodReady();
      await eventButton().click(); await vodReady();
      assert.equal(await page.getByRole("slider", { name: "跳转到敌方技能时间" }).getAttribute("aria-valuemax"), "10");
      await vod().evaluate((video) => video.pause());
      archiveRecording = { ...recordingFixture, pullId: previous.pullId, encounterName: previous.encounterName, encounterStartUnixMs: previous.startedAtUnixMs, encounterEndUnixMs: previous.endedAtUnixMs, timelineEvents: battleEvents.get(previous.pullId), timelineParseErrors: 0, state: "ready" };
      await page.screenshot({ path: path.join(output, "event-history.png"), fullPage: true });
    });
    await run("直播停止后从同场本地录像继续战斗书签", async () => {
      const bookmark = Number(await page.getByRole("slider", { name: "跳转到敌方技能时间" }).getAttribute("aria-valuenow"));
      assert.ok(Math.abs(bookmark - 3) < 0.2);
      await page.evaluate(() => { window.__LIVE_TEST__.liveActive = false; });
      await page.getByRole("button", { name: "打开该场录像", exact: true }).waitFor();
      await page.getByRole("button", { name: "打开该场录像", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="主导航"] [aria-label="回放"]')?.getAttribute("aria-current") === "page");
      const expected = recordingFixture.mapping.videoZeroMs / 1000 + bookmark;
      await page.waitForFunction((time) => { const video = document.querySelector('video[aria-label$="本地回放"]'); return video && video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - time) < 0.2; }, expected);
      await page.waitForFunction((id) => Math.abs(window.__LIVE_TEST__.savedPreferences?.bookmarksMs[id] - 3000) < 200, archiveRecording.pullId);
      report.archiveBookmarkMs = await page.evaluate((id) => window.__LIVE_TEST__.savedPreferences.bookmarksMs[id], archiveRecording.pullId);
      await page.getByRole("navigation").getByRole("button", { name: /直播/ }).click();
    });
    await run("新直播会话隔离旧战斗请求并回收旧连接", async () => {
      const oldId = session.sessionId;
      await page.evaluate(() => { window.__LIVE_TEST__.liveActive = false; });
      await page.waitForFunction(() => !document.querySelector('video[aria-label="实时直播画面"]') && !document.querySelector('video[aria-label="直播历史回放"]'));
      await waitNative(() => resources.size === 0);
      session.sessionId = randomUUID(); activeBattle = null; recentBattles = [];
      await page.evaluate(() => { window.__LIVE_TEST__.liveActive = true; });
      await liveReady();
      assert.notEqual(session.sessionId, oldId);
      assert.equal(await vod().count(), 0);
      assert.equal(await page.getByText("战斗时间轴", { exact: true }).count(), 0);
      assert.equal(resources.size, 1);
      await installBattle("新会话首领");
      assert.ok(Number(await page.getByRole("slider", { name: "跳转到敌方技能时间" }).getAttribute("aria-valuenow")) >= 12);
      assert.equal(await vod().count(), 0);
    });
    await run("停止直播释放 WebRTC 播放资源", async () => {
      await page.evaluate(() => { window.__LIVE_TEST__.liveActive = false; });
      await page.waitForFunction(() => !document.querySelector('video[aria-label="实时直播画面"]'));
      await waitNative(() => resources.size === 0);
      assert.equal(negotiated, released);
    });
    report.negotiated = negotiated; report.released = released;
    assert.deepEqual(report.pageErrors, []); report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = String(error.stack || error);
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {}); throw error;
  } finally { fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (releaseMedia) releaseMedia();
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const child of children) if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
});
