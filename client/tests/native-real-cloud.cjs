const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

// 真正连接隔离 PG／MinIO／Redis／独立 Celery 服务，只显式上传合成 MP4。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const executable = path.resolve(argument("--exe"));
const python = path.resolve(argument("--python"));
const privateFile = path.resolve(argument("--private"));
const withWcl = process.argv.includes("--with-wcl");
const withAnnotations = process.argv.includes("--with-annotations");
const withCalibration = process.argv.includes("--with-calibration");
const fixture = JSON.parse(fs.readFileSync(path.join(argument("--fixture"), "fixture.json"), "utf8"));
const playwright = require(path.resolve(argument("--playwright")));
const appId = "com.wow.recorder.cloudvalidation20261017";
const roaming = path.join(process.env.APPDATA, appId);
const localPulls = ["a".repeat(64), "b".repeat(64)];
const report = { cases: [], pageErrors: [], boundary: "真实 Rust IPC／DPAPI／WebView2／PostgreSQL／私有 MinIO Multipart／Redis／独立 Celery worker+beat；仅合成 MP4，非用户录像" };
let bridge, child, browser, page, info;
const pending = new Map(), buffered = new Map();

function waitEvent(name, timeout = 60000) {
  if (buffered.has(name)) { const value = buffered.get(name); buffered.delete(name); return Promise.resolve(value); }
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(name); reject(new Error(`服务控制事件超时：${name}`)); }, timeout); pending.set(name, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject }); });
}
function requestBridge(action) { const event = ({ inspect: "inspection", revoke: "revoked", downgrade: "downgraded", observerAnalyst: "observerUpdated", wclFail: "wclFixtureUpdated", wclRevision: "wclFixtureUpdated", calibrationVersion: "calibrationVersionChanged" })[action] ?? "cleanup"; const response = waitEvent(event); bridge.stdin.write(JSON.stringify({ action }) + "\n"); return response; }
async function startBridge() {
  bridge = spawn(python, [path.join(__dirname, "real-cloud-stack.py"), "--private", privateFile, "--output", path.join(output, "services"), ...(withWcl ? ["--with-wcl"] : [])], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  let lines = "";
  bridge.stdout.on("data", (data) => {
    lines += data.toString("utf8");
    while (lines.includes("\n")) {
      const index = lines.indexOf("\n"), line = lines.slice(0, index); lines = lines.slice(index + 1);
      let value; try { value = JSON.parse(line); } catch { continue; }
      const listener = pending.get(value.event);
      if (listener) { pending.delete(value.event); listener.resolve(value); } else buffered.set(value.event, value);
    }
  });
  // Python 控制器先过滤服务凭证；禁止将 ready 事件原文写入日志或报告。
  bridge.stderr.on("data", (data) => fs.appendFileSync(path.join(output, "bootstrap.log"), data));
  bridge.once("exit", (code) => { for (const listener of pending.values()) listener.reject(new Error(`隔离服务控制器已退出（${code}）`)); pending.clear(); });
  info = await waitEvent("ready");
  assert.match(info.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
}

async function debugPort() { const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve)); const value = socket.address().port; await new Promise((resolve) => socket.close(resolve)); return value; }
async function invoke(command, args) { return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args }); }
async function launch() {
  const port = await debugPort();
  child = spawn(path.join(output, "app/wow-recorder-client.exe"), [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling` } });
  child.stdout.on("data", (data) => fs.appendFileSync(path.join(output, "native-stdout.log"), data));
  child.stderr.on("data", (data) => fs.appendFileSync(path.join(output, "native-stderr.log"), data));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { try { browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } }
  assert.ok(browser, "原生 WebView2 未就绪"); const context = browser.contexts()[0]; page = context.pages()[0] || await context.waitForEvent("page");
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && document.querySelector("nav"));
  assert.equal(await invoke("plugin:app|identifier"), appId, "禁止操作正式应用");
}
async function close() {
  if (page && !page.isClosed()) await invoke("plugin:window|close", { label: "main" }).catch(() => {});
  if (child && child.exitCode === null) { await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]); if (child.exitCode === null) child.kill(); }
  browser = null; page = null;
}

async function waitJob(jobId, condition, timeout = 180000) {
  const deadline = Date.now() + timeout; let latest, last = "";
  while (Date.now() < deadline) {
    latest = (await invoke("get_cloud_uploads")).find((job) => job.jobId === jobId);
    if (latest?.status === "failed") throw new Error(`真实上传失败：${latest.error}`);
    if (latest && condition(latest)) return latest;
    const label = `${latest?.status ?? "unverified"}/${latest?.recordingStatus ?? "pending"}/${latest?.uploadedBytes ?? 0}`;
    if (label !== last) { console.log(`等待真实上传：${label}`); last = label; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`真实上传未按时完成：${latest?.status}/${latest?.recordingStatus}`);
}

async function waitWcl(status) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const value = await invoke("get_cloud_wcl_status", { pullId: info.teamPullId });
    if (value.status === status) return value;
    if (value.status === "failed" && status !== "failed") throw new Error(`受控WCL导入失败：${value.error}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("受控WCL导入未按时完成");
}

async function main() {
  assert.ok(fs.readFileSync(executable).includes(Buffer.from(appId)), "必须使用独立 cloudvalidation 构建");
  assert.equal(fixture.pullId, "0000000000000000000000000000000000000000000000000000000000000001", "禁止使用真实用户媒体");
  fs.mkdirSync(path.join(output, "app"), { recursive: true }); fs.copyFileSync(executable, path.join(output, "app/wow-recorder-client.exe"));
  const sourceDirectory = path.join(roaming, "synthetic-source"); fs.mkdirSync(sourceDirectory, { recursive: true });
  const sources = [path.join(sourceDirectory, "pov-a.mp4"), path.join(sourceDirectory, "pov-b.mp4")];
  for (const file of sources) fs.copyFileSync(path.normalize(fixture.videoPath), file);
  const padding = Buffer.alloc(12 * 1024 * 1024); padding.writeUInt32BE(padding.length, 0); padding.write("free", 4); fs.appendFileSync(sources[0], padding);
  const hashes = sources.map((file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  const players = ["真实合成甲", "真实合成乙"].map((name, index) => ({ actorId: index + 1, guid: `Player-NativeReal${index}`, name, serverName: "合成服务器", fullType: "Hunter-Marksmanship" }));
  const pulls = sources.map((file, index) => {
    const start = index === 0 ? 12300 : 11800, zero = index === 0 ? 2000 : 4000;
    return { ...structuredClone(fixture), pullId: localPulls[index], encounterId: 7001, encounterName: "真实云端合成首领", state: "ready", error: null,
      difficultyId: 16, encounterStartUnixMs: start, encounterEndUnixMs: start + 10000, clipStartUnixMs: start - zero, clipEndUnixMs: start - zero + fixture.mapping.mediaDurationMs,
      playerName: players[index].name, recordingPlayerGuid: players[index].guid, players, timelineEvents: [], timelineIndexed: true, timelineVersion: 2, timelineParseErrors: 0,
      videoPath: file, importedSource: file, playbackPath: null, mapping: { ...fixture.mapping, slices: [], intervals: [], mediaCalibrated: false, calibrationError: "合成声明偏移",
        actualStartUnixMs: start - zero, actualEndUnixMs: start - zero + fixture.mapping.mediaDurationMs, videoZeroMs: zero },
    };
  });
  fs.writeFileSync(path.join(roaming, "recording-index.json"), JSON.stringify({ schemaVersion: 2, activePull: null, pulls, sources: [], diagnostics: [] }));
  fs.writeFileSync(path.join(roaming, "client-state.json"), JSON.stringify({ schemaVersion: 1, sections: { replay: { catalogSource: "local", selectedPullId: localPulls[0], bookmarksMs: {}, offsetsMs: {}, muted: true, volume: 0.5, playbackRate: 1 } } }));
  const run = async (name, action) => { await action(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
  try {
    await startBridge(); await launch();
    await run("真实服务账号与团队验证，所有凭证保持内存或DPAPI密文", async () => {
      await invoke("set_cloud_settings", { settings: { endpoint: info.endpoint, teamId: info.teamId, token: info.token } });
      const identity = await invoke("verify_cloud_connection"); assert.equal(identity.userId, info.userId); assert.equal(identity.teams[0].teamId, info.teamId);
      const saved = fs.readFileSync(path.join(roaming, "client-state.json"), "utf8"); assert.equal(saved.includes(info.token), false);
      let rejected = false; try { await invoke("enqueue_cloud_upload", { pullId: localPulls[0], teamPullId: "not-a-uuid" }); } catch { rejected = true; } assert.equal(rejected, true);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { const local = await invoke("list_local_recordings"); if (localPulls.every((id) => local.some((recording) => recording.pullId === id && recording.state === "ready"))) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
    });
    let firstJob, secondJob;
    await run("真实Multipart首片确认后关闭原生进程并恢复同一上传任务", async () => {
      firstJob = await invoke("enqueue_cloud_upload", { pullId: localPulls[0], teamPullId: info.teamPullId });
      const partial = await waitJob(firstJob, (job) => job.uploadedBytes > 0 && job.uploadedBytes < job.fileSizeBytes, 60000);
      assert.equal(partial.uploadedBytes, 5 * 1024 * 1024); await close();
      const saved = JSON.parse(fs.readFileSync(path.join(roaming, "client-state.json"))).sections.cloudUploads.find((job) => job.jobId === firstJob);
      assert.ok(saved.uploadId); assert.equal(saved.teamPullId, info.teamPullId); assert.equal(saved.intent, "queued");
      await launch(); const ready = await waitJob(firstJob, (job) => job.recordingStatus === "ready" && job.fullFileSha256Verified, 180000); assert.equal(ready.status, "uploaded");
      const evidence = await requestBridge("inspect"); assert.equal(evidence.recordings.length, 1); assert.equal(evidence.recordings[0].fileSha256, hashes[0]);
      assert.equal(evidence.counts.presign.filter((number) => number === 1).length, 1); assert.equal(evidence.counts.confirm.filter((number) => number === 1).length, 1);
      assert.equal(evidence.parts.length, 3); assert.ok(evidence.parts.every((part) => part.confirmed));
    });
    await run("第二路通过真实IPC显式加入同一团队场次并由独立worker发布", async () => {
      secondJob = await invoke("enqueue_cloud_upload", { pullId: localPulls[1], teamPullId: info.teamPullId });
      await waitJob(secondJob, (job) => job.recordingStatus === "ready" && job.fullFileSha256Verified, 180000);
      const evidence = await requestBridge("inspect"); assert.equal(evidence.recordings.length, 2); assert.equal(evidence.uploadCount, 2); assert.ok(evidence.recordings.every((recording) => recording.status === "ready" && recording.sha256Verified));
      assert.deepEqual(new Set(evidence.recordings.map((recording) => recording.fileSha256)), new Set(hashes));
      assert.ok(evidence.recordings.every((recording) => recording.teamPullId === info.teamPullId));
      assert.equal(evidence.jobs.length, 2); assert.ok(evidence.jobs.every((job) => job.status === "ready" && job.attempts === 1)); assert.equal(evidence.publishedOutbox, 2); report.backend = evidence;
    });
    let remote;
    await run("共同时间基准修正300与负200毫秒并实际播放两路HLS", async () => {
      remote = await invoke("list_cloud_replays", { offset: 0, limit: 100 }); assert.equal(remote.length, 2); assert.equal(remote[0].battleKey, remote[1].battleKey);
      const a = remote.find((recording) => recording.playerName === players[0].name), b = remote.find((recording) => recording.playerName === players[1].name);
      const sourceA = report.backend.recordings.find((recording) => recording.characterGuid === players[0].guid), sourceB = report.backend.recordings.find((recording) => recording.characterGuid === players[1].guid);
      assert.equal(sourceA.localStartUnixMs, 12300); assert.equal(sourceB.localStartUnixMs, 11800);
      assert.equal(a.encounterStartUnixMs, 12000); assert.equal(b.encounterStartUnixMs, 12000); assert.equal(a.mapping.videoZeroMs, sourceA.videoZeroMs - 300); assert.equal(b.mapping.videoZeroMs, sourceB.videoZeroMs + 200);
      const expectedA = 3 + a.mapping.videoZeroMs / 1000, expectedB = 3 + b.mapping.videoZeroMs / 1000;
      await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
      await page.getByText("团队录像", { exact: true }).click(); await page.getByRole("button", { name: `观看${players[0].name}视角`, exact: true }).click();
      const video = page.locator("video[aria-label$='团队回放']"); await page.waitForFunction(() => document.querySelector("video[aria-label$='团队回放']")?.readyState >= 2);
      const axis = page.getByRole("slider", { name: "跳转到敌方技能时间" }); await axis.focus(); await page.keyboard.press("Home"); for (let index = 0; index < 3; index++) await page.keyboard.press("ArrowRight");
      await page.waitForFunction((expected) => { const video = document.querySelector("video[aria-label$='团队回放']"); return !video.seeking && Math.abs(video.currentTime - expected) < 0.2; }, expectedA);
      const actualA = await video.evaluate((element) => element.currentTime);
      await page.getByRole("button", { name: `观看${players[1].name}视角`, exact: true }).click();
      await page.waitForFunction((expected) => { const video = document.querySelector("video[aria-label$='团队回放']"); return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - expected) < 0.2; }, expectedB);
      const actualB = await video.evaluate((element) => element.currentTime);
      // MSE 视频可能污染网页 Canvas，使用 WebView2 合成器截图，保持现有跨源策略。
      const frame = await video.evaluate((element) => ({ width: element.videoWidth, height: element.videoHeight, decodedFrames: element.getVideoPlaybackQuality().totalVideoFrames }));
      assert.equal(frame.width, 320); assert.equal(frame.height, 180); assert.ok(frame.decodedFrames > 0);
      await video.screenshot({ path: path.join(output, "decoded-team-frame.png") });
      await page.screenshot({ path: path.join(output, "native-real-team.png"), fullPage: true });
      report.commonMapping = { localStartDeltaMs: [300, -200], publicationShiftMs:[sourceA.publicationShiftMs,sourceB.publicationShiftMs],responseVideoZeroMs: [a.mapping.videoZeroMs,b.mapping.videoZeroMs], battleSeconds: 3, requestedVideoSeconds: [expectedA,expectedB],actualVideoSeconds: [actualA,actualB], decodedFrame: true,decodedFrames:frame.decodedFrames };
    });
    if (withCalibration) {
      await require("./native-real-cloud-calibration.cjs")({ getPage: () => page, invoke, run, info, remote, players, output, report, close, launch, requestBridge });
    }
    if (withAnnotations) {
      await require("./native-real-cloud-annotations.cjs")({ getPage: () => page, invoke, run, info, remote, players, output, report, close, launch, requestBridge });
    }
    if (withWcl) {
      const a = remote.find((recording) => recording.playerName === players[0].name), b = remote.find((recording) => recording.playerName === players[1].name);
      const importRequest = { reportCode: info.wclReportCode, fightId: 1, actorBindings: [{ recordingId: a.pullId, actorId: 1 }, { recordingId: b.pullId, actorId: 2 }] };
      let firstPage, published;
      await run("受控WCL HTTP经真实PG与Redis独立worker导入完整标准事件", async () => {
        const before = await requestBridge("inspect"); assert.equal(before.wcl.requests, 0);
        const status = await invoke("get_cloud_wcl_status", { pullId: info.teamPullId }); assert.equal(status.configured, true); assert.equal(status.canImport, true);
        await invoke("start_cloud_wcl_import", { pullId: info.teamPullId, request: importRequest }); published = await waitWcl("ready");
        assert.equal(published.eventCount, 7); assert.equal(published.rawEventCount, 7); assert.equal(published.publishedReportRevision, 1); assert.equal(published.actors.find((actor) => actor.actorId === 20).type, null);
        firstPage = await invoke("list_cloud_replay_events", { pullId: a.pullId, cursor: null, limit: 2 }); assert.equal(firstPage.events[0].pullTimeMs, -400);
        const all = [...firstPage.events]; let next = firstPage;
        while (next.hasMore) { next = await invoke("list_cloud_replay_events", { pullId: a.pullId, cursor: next.nextCursor, limit: 2 }); all.push(...next.events); }
        assert.equal(all.length, 7); assert.ok(all.every((event) => event.identityNamespace === `wcl:${info.wclReportCode}` && event.sourceGuid === "" && event.targetGuid === ""));
        assert.ok(all.some((event) => event.sourceActorId === -1)); assert.ok(all.some((event) => event.sourceActorId === 0));
        const other = await invoke("list_cloud_replay_events", { pullId: b.pullId, cursor: firstPage.nextCursor, limit: 100 }); assert.equal(other.reset, true); assert.equal(other.events.find((event) => event.sourceActorId === 2 && event.kind === "castSuccess").owner, "player");
        const evidence = await requestBridge("inspect"); assert.deepEqual(evidence.wcl.pages, [0, 100, 7500]); assert.equal(evidence.wclJobs[0].status, "ready"); assert.equal(evidence.wclJobs[0].attempts, 1); assert.equal(evidence.wclJobs[0].published, true); report.wcl = { eventCount: 7, rawEventCount: 7, signedFirstTimeMs: -400, independentWorker: true };
      });
      await run("原生WCL同名人物筛选与技能点击按公共战斗时间定位真实HLS", async () => {
        await page.getByRole("button", { name: "刷新团队录像", exact: true }).click();
        await page.getByRole("button", { name: `观看${players[0].name}视角`, exact: true }).click();
        const marker = page.getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }); await marker.waitFor();
        assert.equal(await page.getByRole("button", { name: "标准真言盾 施法成功 0:00", exact: true }).count(), 0);
        const actors = page.getByRole("combobox", { name: "筛选事件人物" }); await actors.click(); await page.locator('.ant-select-item-option[title="同名标准角色 · #1"]').click();
        const axis = page.getByRole("slider", { name: "跳转到敌方技能时间" }); await axis.focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => Math.abs(document.querySelector("video[aria-label$='团队回放']").currentTime - 2.7) < 0.2);
        await marker.click(); await page.waitForFunction(() => Math.abs(document.querySelector("video[aria-label$='团队回放']").currentTime - 4.7) < 0.2);
        await actors.click(); await page.locator('.ant-select-item-option[title="同名标准角色 · #2"]').click(); assert.equal(await marker.count(), 0);
        await page.getByRole("button", { name: "标准真言盾 施法成功 0:06", exact: true }).click();
        await page.waitForFunction(() => Math.abs(document.querySelector("video[aria-label$='团队回放']").currentTime - 5.2) < 0.2);
        await actors.click(); await page.locator('.ant-select-item-option[title="同名标准角色 · #1"]').click(); await marker.click();
        await page.getByRole("button", { name: `观看${players[1].name}视角`, exact: true }).click();
        await page.waitForFunction(() => Math.abs(document.querySelector("video[aria-label$='团队回放']").currentTime - 7.2) < 0.2);
        await page.locator('[data-replay-track="team"]').getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, "native-wcl-events.png"), fullPage: true });
      });
      await run("个人自定义轨道与WCL来源覆盖经原生重启保留且不改云事件", async () => {
        const key = `team:642:castSuccess:WCL-${info.wclReportCode}-1`;
        await page.getByRole("button", { name: "轨道布局", exact: true }).click();
        const unicodeName = "😀".repeat(32);
        await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill(unicodeName); await page.getByRole("button", { name: "新增个人轨道", exact: true }).click();
        await new Promise((resolve) => setTimeout(resolve, 700)); assert.equal((await invoke("get_replay_preferences")).customTimelineTracks[0].name, unicodeName);
        await page.getByRole("textbox", { name: "轨道名称 " + unicodeName, exact: true }).fill("原生个人验证轨道");
        await page.getByRole("button", { name: "保存" + unicodeName + "轨道名称", exact: true }).click();
        await page.getByText("战斗时间轴", { exact: true }).click();
        const target = page.getByRole("slider", { name: "跳转到原生个人验证轨道时间", exact: true }); await target.waitFor();
        const id = await target.locator("..").getAttribute("data-replay-track"); assert.match(id, /^custom-[0-9a-f-]{36}$/);
        await page.getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).dragTo(target);
        await page.locator(`[data-replay-track="${id}"]`).getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
        await new Promise((resolve) => setTimeout(resolve, 700)); assert.equal((await invoke("get_replay_preferences")).timelineTrackOverrides[key], id);
        await close(); await launch(); await invoke("verify_cloud_connection");
        const restored = await invoke("get_replay_preferences"); assert.equal(restored.customTimelineTracks[0].id, id); assert.equal(restored.timelineTrackOverrides[key], id);
        await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
        await page.getByRole("button", { name: `观看${players[1].name}视角`, exact: true }).click();
        await page.locator(`[data-replay-track="${id}"]`).getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
        const unchanged = await invoke("list_cloud_replay_events", { pullId: b.pullId, cursor: null, limit: 100 }); assert.equal(unchanged.total, 7); assert.equal(unchanged.events.find((event) => event.spellId === 642).owner, "team");
        report.wcl.personalTrackSurvivedRestart = true; await page.screenshot({ path: path.join(output, "native-wcl-personal-track.png"), fullPage: true });
        await page.getByRole("button", { name: "轨道布局", exact: true }).click(); await page.getByRole("button", { name: "删除原生个人验证轨道轨道", exact: true }).click(); await page.getByText("战斗时间轴", { exact: true }).click();
        await page.locator('[data-replay-track="team"]').getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).click();
        await page.waitForFunction(() => Math.abs(document.querySelector("video[aria-label$='团队回放']").currentTime - 7.2) < 0.2); report.wcl.personalTrackMouseLifecycle = true;
      });
      await run("受控报告刷新失败保旧，成功新版本重置旧游标且不改视频映射", async () => {
        await requestBridge("wclFail"); await invoke("start_cloud_wcl_import", { pullId: info.teamPullId, request: { ...importRequest, refresh: true } });
        const failed = await waitWcl("failed"); assert.equal(failed.revision, published.revision); assert.ok(failed.error);
        const retained = await invoke("list_cloud_replay_events", { pullId: a.pullId, cursor: firstPage.nextCursor, limit: 2 }); assert.equal(retained.revision, firstPage.revision); assert.equal(retained.reset, false);
        await requestBridge("wclRevision"); await invoke("start_cloud_wcl_import", { pullId: info.teamPullId, request: { ...importRequest, refresh: true } });
        const updated = await waitWcl("ready"); assert.equal(updated.publishedReportRevision, 2); assert.notEqual(updated.revision, published.revision);
        const reset = await invoke("list_cloud_replay_events", { pullId: a.pullId, cursor: firstPage.nextCursor, limit: 2 }); assert.equal(reset.reset, true); assert.notEqual(reset.revision, firstPage.revision);
        remote = await invoke("list_cloud_replays", { offset: 0, limit: 100 }); assert.equal(remote.find((view) => view.pullId === a.pullId).mapping.videoZeroMs, 1700); assert.equal(remote.find((view) => view.pullId === b.pullId).mapping.videoZeroMs, 4200);
        report.wcl.failedRefreshRetainedOld = true; report.wcl.revisionChanged = true;
      });
      await run("真实降权后禁止重导入，已发布标准事件仍按团队权限可读", async () => {
        await requestBridge("downgrade"); const status = await invoke("get_cloud_wcl_status", { pullId: info.teamPullId }); assert.equal(status.canImport, false);
        const before = (await requestBridge("inspect")).wcl.requests;
        let denied = false; try { await invoke("start_cloud_wcl_import", { pullId: info.teamPullId, request: { ...importRequest, refresh: true } }); } catch { denied = true; } assert.equal(denied, true);
        assert.equal((await requestBridge("inspect")).wcl.requests, before); assert.equal((await invoke("list_cloud_replay_events", { pullId: a.pullId, cursor: null, limit: 100 })).total, 7);
        report.wcl.roleBoundaryVerified = true;
        if (withAnnotations) {
          const snapshot = await invoke("get_cloud_replay_annotations", { pullId: b.pullId }); assert.equal(snapshot.canEdit, true);
          await invoke("save_cloud_replay_annotations", { pullId: b.pullId, request: { expectedVersion: snapshot.version, items: snapshot.items } }); report.annotations.memberUploaderCanEdit = true;
        }
      });
    }
    await run("真实撤销团队成员后旧媒体和目录权限立即失效", async () => {
      await requestBridge("revoke");
      const result = await page.evaluate(async (url) => { const response = await fetch(url); return response.status; }, remote[0].playbackUrl); assert.ok(result >= 400);
      let denied = false; try { await invoke("list_cloud_replays", { offset: 0, limit: 100 }); } catch { denied = true; } assert.equal(denied, true);
      assert.equal((await invoke("verify_cloud_connection")).teams.length, 0);
      if (withWcl) { let denied = false; try { await invoke("list_cloud_replay_events", { pullId: remote[0].pullId, cursor: null, limit: 100 }); } catch { denied = true; } assert.equal(denied, true); }
      if (withCalibration) {
        for (const command of ["get_cloud_replay_calibration", "save_cloud_replay_calibration"]) {
          let denied = false; try { await invoke(command, { pullId: remote[0].pullId, request: { expectedVersion: 0, playbackVersion: remote[0].cloudPlaybackVersion, offsetMs: 0 } }); } catch { denied = true; } assert.equal(denied, true);
        }
        report.calibration.revokedReadWriteDenied = true;
      }
      if (withAnnotations) {
        for (const command of ["get_cloud_replay_annotations", "save_cloud_replay_annotations"]) {
          let denied = false; try { await invoke(command, { pullId: remote[0].pullId, request: { expectedVersion: 0, items: [] } }); } catch { denied = true; } assert.equal(denied, true);
        } report.annotations.revokedReadWriteDenied = true;
      }
      assert.deepEqual(sources.map((file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")), hashes);
    });
    assert.deepEqual(report.pageErrors, []); report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = String(error.stack || error);
    if (withCalibration && page) report.calibrationControls = await page.locator('button[aria-label="保存团队对齐"]').evaluateAll((nodes) => nodes.map((node) => ({
      label: node.getAttribute("aria-label"), text: node.textContent, disabled: node.disabled,
      hiddenAncestor: node.closest('[aria-hidden="true"], [inert]')?.tagName, className: node.className,
    }))).catch(() => []);
    if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {}); throw error;
  } finally {
    await close();
    if (bridge && bridge.exitCode === null) { report.cleanup = await requestBridge("cleanup"); bridge.stdin.end(); assert.equal(report.cleanup.cleaned, true); }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
