const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { loadSource } = require("./source-loader.cjs");

// 仅向本机协议夹具发送合成数据；Rust IPC 在浏览器边界替换，不读取或上传用户录像。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const fixture = JSON.parse(fs.readFileSync(path.join(argument("--fixture"), "fixture.json"), "utf8"));
const playwright = require(path.resolve(argument("--playwright")));
const clientRoot = path.resolve(__dirname, "..");
const defaults = loadSource("src/features/obs/model.ts");
const identity = { userId: "fixture-user", displayName: "测试云端用户", teams: [{ teamId: "team-1", name: "测试团队甲", role: "leader" }, { teamId: "team-2", name: "测试团队乙", role: "member" }] };
const fixtureToken = "fixture-cloud-token";
const testBytes = Buffer.alloc(65536, 7);
const settings = { endpoint: "", teamId: null, deviceId: "fixture-device", hasToken: false, identity: null, connectionKey: "" };
const jobs = [];
const calls = { verify: 0, enqueue: 0, retry: 0, pause: 0, cancel: 0, uploadedBytes: 0, requests: 0, catalog: [] };
calls.processingRetry = 0;
const cloudRecords = [];
const existingTeamPullId = randomUUID();
const cloudMediaRequests = new Set();
let catalogFailure = false;
let processingForbidden = true;
let uploadFailure = null;
calls.enqueueTargets = [];
calls.rejectedTargets = 0;
const makeCloudRecord = (index, playerName, status) => {
  const pullId = randomUUID();
  return { ...structuredClone(fixture), pullId, encounterId: fixture.encounterId + 1, encounterName: "另一测试首领", importedSource: null, recordingPlayerGuid: `Player-Cloud${index}`, battleKey: `team-1:${existingTeamPullId}`, cloudTeamPullId: existingTeamPullId, playerName,
    timelineEvents: [], timelineRevision: undefined, timelineComplete: false, timelineEventCount: 0, cloudStatus: status,
    videoPath: null, playbackPath: null, playbackUrl: status === "ready" ? `http://cloud-replay.localhost/${pullId}/index.m3u8` : null,
    state: status === "ready" ? "ready" : status === "uploaded" ? "waitingForPlayback" : "processing",
  };
};
cloudRecords.push(makeCloudRecord(0, "团队成员甲", "ready"), makeCloudRecord(1, "团队成员乙", "ready"), makeCloudRecord(2, "团队成员丙", "uploaded"), makeCloudRecord(3, "缺片成员", "ready"));
cloudRecords[1].mapping.videoZeroMs += 800;
for (const interval of cloudRecords[1].mapping.intervals) { interval.videoStartMs += 800; interval.videoEndMs += 800; }
cloudRecords[3].state = "partial"; cloudRecords[3].mapping.hasGap = true;
cloudRecords[3].mapping.intervals = [{ pullStartMs: 0, pullEndMs: 3000, videoStartMs: 0, videoEndMs: 3000 }];
for (const recording of cloudRecords) recording.players = cloudRecords.map((view) => ({ guid: view.recordingPlayerGuid, name: view.playerName }));
for (let index = 4; index < 101; index++) {
  const cloudTeamPullId = randomUUID();
  cloudRecords.push({ ...makeCloudRecord(index, `待处理成员${index}`, "processing"), encounterId: 7001 + index, encounterName: `团队待处理首领 ${index}`, battleKey: `team-1:${cloudTeamPullId}`, cloudTeamPullId, players: [] });
}
cloudRecords[4] = { ...makeCloudRecord(4, "处理失败成员", "failed"), state: "failed", canRetryProcessing: true };
cloudRecords[5] = { ...makeCloudRecord(5, "无权限成员", "failed"), state: "failed" };
const report = { cases: [], pageErrors: [], boundary: "真实 React 和本机 HTTP 协议夹具；IPC 为测试适配，未连接真实 PostgreSQL/S3，未上传用户数据" };
let savedToken = "";
let expectedToken = fixtureToken;
let credentialRevision = 0;
let serverReady = false;
let page, browser, appServer, cloudServer;
fs.mkdirSync(output, { recursive: true });

async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); }
async function listen(server) { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${server.address().port}`; }

async function main() {
  cloudServer = http.createServer(async (request, response) => {
    calls.requests++;
    if (request.headers.authorization !== `Bearer ${expectedToken}`) { response.writeHead(401).end(); return; }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/me") { calls.verify++; response.end(JSON.stringify(identity)); return; }
    if (request.url.startsWith("/replays?")) {
      const query = new URL(request.url, "http://localhost").searchParams;
      const offset = Number(query.get("offset")), limit = Number(query.get("limit"));
      assert.ok(Number.isInteger(offset) && offset >= 0 && limit === 100);
      response.end(JSON.stringify(cloudRecords.slice(offset, offset + limit))); return;
    }
    if (request.url === `/replays/${cloudRecords[4].pullId}/retry-processing` && request.method === "POST") {
      calls.processingRetry++;
      if (processingForbidden) { response.writeHead(403).end(JSON.stringify({ error: "仅允许上传者重试处理" })); return; }
      cloudRecords[4].state = "processing"; cloudRecords[4].cloudStatus = "processing"; cloudRecords[4].canRetryProcessing = false;
      response.end(JSON.stringify({ status: "processing" })); return;
    }
    if (request.url === "/upload" && request.method === "POST") {
      const input = JSON.parse(await body(request));
      if (input.teamPullId) assert.equal(input.teamPullId, existingTeamPullId);
      if (uploadFailure) { calls.rejectedTargets++; response.writeHead(uploadFailure === "server" ? 500 : 403).end(JSON.stringify({ error: "目标场次校验失败" })); return; }
      calls.enqueueTargets.push(input.teamPullId ?? null); response.end(JSON.stringify({ accepted: true })); return;
    }
    if (request.url === "/part" && request.method === "PUT") { const bytes = await body(request); assert.ok(bytes.every((value) => value === 7)); calls.uploadedBytes += bytes.length; response.end(JSON.stringify({ received: bytes.length })); return; }
    if (request.url === "/status") { response.end(JSON.stringify({ recordingStatus: serverReady ? "ready" : "processing" })); return; }
    response.writeHead(404).end();
  });
  const cloudOrigin = await listen(cloudServer);
  const api = async (resource, options = {}) => {
    assert.equal(settings.endpoint, cloudOrigin, "测试禁止向本机夹具之外的地址发送请求");
    const response = await fetch(`${cloudOrigin}${resource}`, { ...options, headers: { Authorization: `Bearer ${savedToken}`, ...(options.headers ?? {}) } });
    if (!response.ok) throw new Error(`测试服务器 HTTP ${response.status}`);
    return response.json();
  };
  appServer = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const root = path.join(clientRoot, "dist"); const file = path.resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(response);
  });
  const appOrigin = await listen(appServer);
  browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  const recordings = [fixture, { ...fixture, pullId: "0000000000000000000000000000000000000000000000000000000000000002", encounterName: "另一测试首领", encounterId: fixture.encounterId + 1, encounterStartUnixMs: fixture.encounterStartUnixMs + 60000, encounterEndUnixMs: fixture.encounterEndUnixMs + 60000 }];
  await page.exposeFunction("__CLOUD_NATIVE__", async (command, args) => {
    if (command === "get_cloud_settings") return structuredClone(settings);
    if (command === "get_cloud_uploads") {
      for (const job of jobs.filter((item) => item.status === "uploaded" && item.origin === settings.endpoint && settings.hasToken)) job.recordingStatus = (await api("/status")).recordingStatus;
      return structuredClone(jobs);
    }
    if (command === "set_cloud_settings") {
      assert.ok(args.settings && !Object.hasOwn(args, "token"));
      const input = args.settings;
      if (input.endpoint !== "" && input.endpoint !== cloudOrigin) throw new Error("服务器地址无效，测试仅允许本机协议夹具");
      if (input.endpoint !== settings.endpoint) { savedToken = ""; settings.identity = null; credentialRevision++; }
      settings.endpoint = input.endpoint; settings.teamId = input.teamId;
      if (input.token !== undefined) { savedToken = input.token; settings.identity = null; credentialRevision++; }
      if (!input.endpoint) { savedToken = ""; settings.teamId = null; settings.identity = null; }
      settings.hasToken = Boolean(savedToken); settings.connectionKey = input.endpoint ? `fixture-connection-${credentialRevision}` : ""; return;
    }
    if (command === "verify_cloud_connection") { settings.identity = await api("/me"); return structuredClone(settings.identity); }
    if (command === "list_cloud_replays") {
      calls.catalog.push({ offset: args.offset, limit: args.limit });
      if (catalogFailure) throw new Error("测试团队目录暂时不可用");
      return api(`/replays?offset=${args.offset}&limit=${args.limit}`);
    }
    if (command === "retry_cloud_replay_processing") {
      assert.equal(args.recordingId, cloudRecords[4].pullId);
      await api(`/replays/${args.recordingId}/retry-processing`, { method: "POST" }); return;
    }
    if (command === "enqueue_cloud_upload") {
      assert.ok(identity.teams.some((team) => team.teamId === settings.teamId));
      assert.ok(recordings.some((recording) => recording.pullId === args.pullId));
      await api("/upload", { method: "POST", body: JSON.stringify({ pullId: args.pullId, teamPullId: args.teamPullId }) });
      calls.enqueue++;
      const job = { jobId: `job-${jobs.length + 1}`, pullId: args.pullId, origin: cloudOrigin, teamId: settings.teamId, teamPullId: args.teamPullId ?? null, encounterName: recordings.find((item) => item.pullId === args.pullId).encounterName, intent: "queued", status: "uploading", uploadedBytes: 0, fileSizeBytes: testBytes.length, recordingStatus: null, verification: null, fullFileSha256Verified: false, error: null };
      jobs.push(job); return job.jobId;
    }
    const match = /^(retry|pause|cancel)_cloud_upload$/.exec(command);
    if (match) {
      const action = match[1]; calls[action]++;
      const job = jobs.find((item) => item.jobId === args.jobId); assert.ok(job);
      job.status = action === "retry" ? "uploading" : action === "pause" ? "paused" : "cancelled";
      job.intent = action === "retry" ? "queued" : action === "pause" ? "paused" : "cancelled"; job.error = null; return;
    }
    if (command === "list_local_recordings") return recordings;
    if (command === "get_spell_metadata") return [];
    if (command === "get_local_replay_annotations" || command === "get_cloud_replay_annotations") return { version: 0, items: [], canEdit: true };
    return null;
  });
  await page.addInitScript(({ defaults, fixture }) => {
    let callback = 0;
    window.__CLOUD_TEST__ = {};
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, transformCallback: () => ++callback, unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command === "get_obs_status") return defaults.disconnectedObsStatus;
        if (command === "get_obs_installation") return defaults.defaultInstallationStatus;
        if (command === "get_cached_obs_settings") return null;
        if (command === "get_live_session") return null;
        if (command === "get_replay_preferences") return { selectedPullId: fixture.pullId, bookmarksMs: {}, offsetsMs: {}, volume: 1, muted: true, playbackRate: 1, eventKinds: [], actorGuid: null, timelineTrackHeight: 30, timelineIconPercent: 80, timelineZoom: 1, timelineTrackOverrides: {} };
        if (command === "set_replay_preferences") { window.__CLOUD_TEST__.preferences = structuredClone(args.preferences); return; }
        if (command === "get_recording_import_preferences") return { directory: "", logPaths: [] };
        if (command === "get_recording_import") return { taskId: null, status: "idle", totalRecordings: 0, processedRecordings: 0, importedCount: 0, skippedCount: 0, failedCount: 0, bytesRead: 0, totalBytes: 0, currentFile: null, error: null, issues: [], pullIds: [] };
        if (command === "plugin:event|listen") return ++callback;
        if (command === "plugin:window|is_maximized") return false;
        return window.__CLOUD_NATIVE__(command, args);
      },
    };
  }, { defaults: { disconnectedObsStatus: defaults.disconnectedObsStatus, defaultInstallationStatus: defaults.defaultInstallationStatus }, fixture });
  await page.route("http://local-replay.localhost/**", async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({ path: path.join(path.dirname(fixture.playbackPath), file), contentType: file.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.route("http://cloud-replay.localhost/**", async (route) => {
    const url = new URL(route.request().url());
    cloudMediaRequests.add(url.pathname.split("/")[1]);
    const file = path.basename(url.pathname);
    await route.fulfill({ path: path.join(path.dirname(fixture.playbackPath), file), contentType: file.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  const run = async (name, task) => { await task(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
  const navigate = (name) => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name, exact: true }).click();
  const storage = async () => { await navigate("设置"); await page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "上传与存储" }).click(); };
  const refresh = () => page.getByRole("button", { name: "刷新上传任务", exact: true }).click();
  const chooseUploadTarget = async (existing = false) => {
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: existing ? "加入已有战斗" : "新建团队战斗", exact: true }).check();
    if (existing) {
      await dialog.getByRole("combobox", { name: "选择已有团队战斗", exact: true }).click();
      await page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: existingTeamPullId.slice(0, 8) }).click();
    }
    await dialog.getByRole("button", { name: "确认上传到团队", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  };
  let directoryCallCount = 0;
  const advance = async (job, bytes) => { await api("/part", { method: "PUT", body: testBytes.subarray(0, bytes) }); job.uploadedBytes += bytes; };
  try {
    await page.goto(appOrigin);
    await run("未配置账号和上传禁用，不发送云端请求", async () => {
      await navigate("个人中心"); await page.getByRole("heading", { name: "尚未连接账号" }).waitFor();
      assert.equal(await page.getByText("本地演示账号", { exact: true }).count(), 0);
      await navigate("回放");
      assert.equal(await page.getByRole("button", { name: "上传录像", exact: true }).isDisabled(), true);
      await page.getByText("团队录像", { exact: true }).click();
      await page.getByText("请先在设置的上传与存储配置团队服务器。", { exact: true }).waitFor();
      assert.equal(calls.catalog.length, 0);
      await page.getByText("本地录像", { exact: true }).click();
      assert.equal(calls.requests, 0); assert.equal(calls.enqueue, 0);
    });
    await run("失败提交清空密码，页面不回显令牌", async () => {
      await storage();
      await page.getByRole("textbox", { name: "云端服务器地址" }).fill("不是有效地址");
      await page.locator('input[aria-label="云端访问令牌"]').fill(fixtureToken);
      await page.getByRole("button", { name: "保存并验证", exact: true }).click();
      await page.getByText("云端操作失败", { exact: true }).waitFor();
      assert.equal(await page.locator('input[aria-label="云端访问令牌"]').inputValue(), "");
      assert.equal((await page.locator("body").innerText()).includes(fixtureToken), false);
      assert.equal(calls.requests, 0);
    });
    await run("实际 HTTP 验证身份，只选择服务器授权团队", async () => {
      await page.getByRole("textbox", { name: "云端服务器地址" }).fill(cloudOrigin);
      await page.locator('input[aria-label="云端访问令牌"]').fill(fixtureToken);
      await page.getByRole("button", { name: "保存并验证", exact: true }).click();
      await page.getByRole("button", { name: "测试云端用户", exact: true }).waitFor();
      await page.getByRole("combobox", { name: "云端授权团队" }).click();
      await page.locator(".ant-select-dropdown").getByText("测试团队甲", { exact: true }).click();
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="云端授权团队"]').closest(".ant-select").textContent.includes("测试团队甲"));
      assert.equal(settings.teamId, "team-1"); assert.equal(calls.verify, 1); assert.equal(calls.enqueue, 0);
      assert.equal(await page.locator('input[aria-label="云端访问令牌"]').inputValue(), "");
      await navigate("个人中心"); await page.getByRole("heading", { name: "测试云端用户" }).waitFor();
      assert.equal(await page.getByText("测试团队乙", { exact: true }).count(), 1);
    });
    await run("只有明确选择并点击才加入上传队列", async () => {
      await navigate("回放");
      await page.getByRole("button", { name: "上传录像", exact: true }).click();
      await chooseUploadTarget();
      await page.getByText("已加入上传队列，可在上传与存储查看进度", { exact: true }).waitFor();
      assert.equal(calls.enqueue, 1); assert.equal(jobs.length, 1); assert.equal(calls.uploadedBytes, 0);
      await storage(); await page.getByText("上传中", { exact: true }).waitFor();
    });
    await run("真实字节进度及暂停、继续、错误重试", async () => {
      await advance(jobs[0], 16384); await refresh();
      await page.getByText("16.0 KiB / 64.0 KiB", { exact: true }).waitFor();
      await page.getByRole("button", { name: "暂停", exact: true }).click(); await page.getByText("已暂停", { exact: true }).waitFor();
      await page.getByRole("button", { name: "继续上传", exact: true }).click(); await page.getByText("上传中", { exact: true }).waitFor();
      jobs[0].status = "failed"; jobs[0].error = "测试连接中断"; await refresh();
      await page.getByText("测试连接中断", { exact: true }).waitFor();
      await page.getByRole("button", { name: "重试上传", exact: true }).click(); await page.getByText("上传中", { exact: true }).waitFor();
      assert.equal(calls.pause, 1); assert.equal(calls.retry, 2);
    });
    await run("文件上传与云端播放就绪分开显示", async () => {
      await advance(jobs[0], 49152); jobs[0].status = "uploaded"; jobs[0].intent = "completed"; jobs[0].fullFileSha256Verified = true;
      await refresh(); await page.getByText("文件已上传", { exact: true }).waitFor();
      await page.getByText("等待云端处理完成", { exact: true }).waitFor();
      assert.equal(await page.getByText("云端播放已就绪", { exact: true }).count(), 0);
      serverReady = true; await refresh(); await page.getByText("云端播放已就绪", { exact: true }).waitFor();
      assert.equal(calls.uploadedBytes, testBytes.length);
    });
    await run("选定任务取消和重新上传，不影响已完成任务", async () => {
      await navigate("回放");
      await page.locator(".replay-encounter").filter({ hasText: "另一测试首领" }).locator(".replay-pull").click();
      await page.getByRole("button", { name: "上传录像", exact: true }).click();
      await chooseUploadTarget(true);
      await storage();
      const row = page.getByRole("row").filter({ hasText: "另一测试首领" });
      await row.getByRole("button", { name: "取消", exact: true }).click(); await row.getByText("已取消", { exact: true }).waitFor();
      await row.getByRole("button", { name: "重新上传", exact: true }).click(); await row.getByText("上传中", { exact: true }).waitFor();
      assert.equal(calls.cancel, 1); assert.equal(jobs[0].status, "uploaded"); assert.equal(calls.enqueue, 2);
      assert.equal(jobs[1].teamPullId, existingTeamPullId);
    });
    await run("首次上传明确选择目标，500和权限失败不创建错误任务", async () => {
      recordings.push({ ...recordings[1], pullId: "0000000000000000000000000000000000000000000000000000000000000003", encounterStartUnixMs: recordings[1].encounterStartUnixMs + 60000, encounterEndUnixMs: recordings[1].encounterEndUnixMs + 60000 });
      await navigate("回放"); await page.getByRole("button", { name: "刷新本地录像", exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll(".replay-encounter")].some((group) => group.textContent.includes("另一测试首领") && group.querySelectorAll(".replay-pull").length === 2));
      await page.locator(".replay-encounter").filter({ hasText: "另一测试首领" }).locator(".replay-pull").first().click();
      await page.getByRole("button", { name: "上传录像", exact: true }).click();
      const dialog = page.getByRole("dialog");
      assert.equal(await dialog.getByRole("button", { name: "确认上传到团队", exact: true }).isDisabled(), true);
      await dialog.getByRole("radio", { name: "加入已有战斗", exact: true }).check();
      await dialog.getByRole("combobox", { name: "选择已有团队战斗", exact: true }).click();
      await page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: existingTeamPullId.slice(0, 8) }).click();
      uploadFailure = "server";
      await dialog.getByRole("button", { name: "确认上传到团队", exact: true }).click();
      await dialog.getByText("Error: 测试服务器 HTTP 500", { exact: true }).waitFor();
      uploadFailure = "forbidden";
      await dialog.getByRole("button", { name: "确认上传到团队", exact: true }).click();
      await dialog.getByText("Error: 测试服务器 HTTP 403", { exact: true }).waitFor();
      assert.equal(jobs.length, 2); assert.equal(calls.rejectedTargets, 2);
      uploadFailure = null;
      await dialog.getByRole("button", { name: "取消上传选择", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    });
    await run("团队目录只分页元数据，ready播放且明确等待标准事件", async () => {
      await navigate("回放");
      const beforeCatalog = calls.catalog.length;
      await page.getByText("团队录像", { exact: true }).click();
      await page.getByText("等待标准战斗事件", { exact: true }).waitFor();
      await page.waitForFunction(() => { const video = document.querySelector('video[aria-label$="团队回放"]'); return video && video.readyState >= 2 && !video.seeking; });
      assert.deepEqual(calls.catalog.slice(beforeCatalog), [{ offset: 0, limit: 100 }]);
      assert.deepEqual([...cloudMediaRequests], [cloudRecords[0].pullId]);
      assert.equal(await page.getByRole("button", { name: "观看团队成员丙视角", exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "上传录像", exact: true }).count(), 0);
      await page.waitForTimeout(2200);
      assert.equal(calls.catalog.length, beforeCatalog + 1);
      await page.getByRole("button", { name: "加载更多团队录像", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="加载更多团队录像"]'));
      assert.deepEqual(calls.catalog.at(-1), { offset: 100, limit: 100 });
      directoryCallCount = calls.catalog.length;
    });
    await run("团队双视角独立偏移、缺片拒绝及来源恢复", async () => {
      const axis = page.getByRole("slider", { name: "跳转到敌方技能时间" });
      const bounds = await axis.boundingBox();
      await axis.click({ position: { x: bounds.width * 0.6, y: bounds.height / 2 } });
      const base = fixture.mapping.videoZeroMs / 1000 + 6;
      await page.waitForFunction((time) => { const video = document.querySelector('video[aria-label$="团队回放"]'); return video && !video.seeking && Math.abs(video.currentTime - time) < 0.15; }, base);
      await page.locator('video[aria-label$="团队回放"]').evaluate((video) => { video.volume = 0.45; video.playbackRate = 1.5; });
      await page.getByRole("button", { name: "观看团队成员乙视角", exact: true }).click();
      await page.waitForFunction((time) => { const video = document.querySelector('video[aria-label$="团队回放"]'); return video && video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - time) < 0.15; }, base + 0.8);
      assert.deepEqual(await page.locator('video[aria-label$="团队回放"]').evaluate((video) => [video.volume, video.playbackRate]), [0.45, 1.5]);
      await page.getByRole("button", { name: "观看缺片成员视角", exact: true }).click();
      await page.getByText("该人物的录像尚不可播放或不覆盖当前战斗时间，已保留当前视角。", { exact: true }).waitFor();
      assert.match(await page.locator(".replay-header-title").textContent(), /团队成员乙/);
      await navigate("个人中心"); await navigate("回放");
      await page.getByText("等待标准战斗事件", { exact: true }).waitFor();
      assert.match(await page.locator(".replay-header-title").textContent(), /团队成员乙/);
      assert.equal(calls.catalog.length, directoryCallCount);
      await page.waitForFunction(() => window.__CLOUD_TEST__.preferences?.catalogSource === "team");
      await page.getByText("本地录像", { exact: true }).click();
      await page.getByRole("button", { name: "上传录像", exact: true }).waitFor();
      await page.getByText("团队录像", { exact: true }).click();
      assert.equal(calls.catalog.length, directoryCallCount);
    });
    await run("团队失败成员仅有权限时可重排处理，403明确且不重传文件", async () => {
      assert.equal(await page.getByRole("button", { name: "重试无权限成员的云端处理", exact: true }).count(), 0);
      const bytesBefore = calls.uploadedBytes, uploadsBefore = calls.enqueue;
      const retry = page.getByRole("button", { name: "重试处理失败成员的云端处理", exact: true });
      await retry.click();
      await page.getByText("重试处理失败", { exact: true }).waitFor();
      await page.getByText("Error: 测试服务器 HTTP 403", { exact: true }).waitFor();
      processingForbidden = false; await retry.click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="重试处理失败成员的云端处理"]'));
      assert.equal(calls.processingRetry, 2); assert.equal(calls.uploadedBytes, bytesBefore); assert.equal(calls.enqueue, uploadsBefore);
      assert.match(await page.locator(".replay-header-title").textContent(), /团队成员乙/);
    });
    await run("团队目录读取失败明确反馈并可重新读取", async () => {
      catalogFailure = true;
      await page.getByRole("button", { name: "刷新团队录像", exact: true }).click();
      await page.getByText("读取团队录像失败", { exact: true }).waitFor();
      catalogFailure = false;
      await page.getByRole("button", { name: "重新读取", exact: true }).click();
      await page.getByText("等待标准战斗事件", { exact: true }).waitFor();
      await storage();
    });
    await run("同服务器轮换令牌后团队目录缓存重新验证", async () => {
      const before = calls.catalog.length;
      const previousKey = settings.connectionKey;
      expectedToken = `${fixtureToken}-rotated`;
      await page.locator('input[aria-label="云端访问令牌"]').fill(expectedToken);
      await page.getByRole("button", { name: "保存并验证", exact: true }).click();
      await page.getByRole("button", { name: "测试云端用户", exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('input[aria-label="云端访问令牌"]').disabled);
      assert.notEqual(settings.connectionKey, previousKey);
      assert.equal(await page.locator('input[aria-label="云端访问令牌"]').inputValue(), "");
      await navigate("回放");
      await page.getByText("等待标准战斗事件", { exact: true }).waitFor();
      assert.equal(calls.catalog.length, before + 1);
      await storage();
    });
    await run("清除连接后身份和令牌清空，旧任务保留", async () => {
      await page.getByRole("button", { name: "清除连接设置", exact: true }).click();
      await page.getByRole("button", { name: "未连接账号", exact: true }).waitFor();
      assert.equal(settings.hasToken, false); assert.equal(savedToken, ""); assert.equal(settings.identity, null); assert.equal(jobs.length, 2);
      assert.equal((await page.locator("body").innerText()).includes(fixtureToken), false);
      for (const [width, height] of [[1440, 900], [1080, 720]]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.locator("main").evaluate((node) => node.scrollWidth <= node.clientWidth), true);
        await page.screenshot({ path: path.join(output, `cloud-${width}.png`), fullPage: true });
      }
    });
    assert.deepEqual(report.pageErrors, []); report.calls = calls; report.tokenNotRendered = true; report.passed = true;
  } catch (failure) {
    report.passed = false; report.failure = String(failure.stack || failure);
    await page.locator('input[type="password"]').fill("").catch(() => {});
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    throw failure;
  } finally { fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  for (const server of [appServer, cloudServer]) if (server) await new Promise((resolve) => server.close(resolve));
});
