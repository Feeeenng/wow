const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { prepareDeathReview, verifyDeathReview, cleanupDeathFixtures } = require("./native-death-review.cjs");
const { verifyNativeTrackDetails } = require("./timeline/native-track-details.cjs");
const { waitUntil } = require("./wait-until.cjs");

// 复用隔离索引和 HLS；显式 --audit 时允许新解析器只读升级事件，不转码或上传。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const executable = path.resolve(argument("--exe"));
const sourceIndex = path.resolve(argument("--index"));
const auditDirectory = process.argv.includes("--audit") ? path.resolve(argument("--audit")) : null;
const pullIndex = process.argv.includes("--pull-index") ? Number(argument("--pull-index")) : 0;
const playwright = require(path.resolve(argument("--playwright")));
const appId = "com.wow.recorder.cloudvalidation20261017";
const roaming = path.join(process.env.APPDATA, appId);
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { pageErrors: [], forcedStops: 0, boundary: "已固定独立验收 EXE；真实只读原片和既有HLS；仅显式审计路径允许只读升级日志事件，无云服务／转码／正式数据写入" };
let child, page;
const networkReads = [];
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });

async function launch() {
  const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  child = spawn(path.join(output, "app/wow-recorder-client.exe"), [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling` } });
  for (const [stream, name] of [[child.stdout, "stdout.log"], [child.stderr, "stderr.log"]]) stream.on("data", (data) => fs.appendFileSync(path.join(output, name), data));
  let browser; const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { try { browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); } }
  assert.ok(browser, "独立 WebView2 未就绪"); page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (!response.url().startsWith("http://local-replay.localhost/")) return;
    networkReads.push((async () => {
      const entry = { file: new URL(response.url()).pathname.split("/").at(-1), status: response.status() };
      try { const bytes = await response.body(); entry.bytes = bytes.length; entry.sha256 = crypto.createHash("sha256").update(bytes).digest("hex"); }
      catch (error) { entry.readError = String(error); }
      (report.network ??= []).push(entry);
    })());
  });
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && document.querySelector("nav"));
  assert.equal(await invoke("plugin:app|identifier"), appId, "禁止操作正式应用");
}

async function close() {
  if (page && !page.isClosed()) await invoke("plugin:window|close", { label: "main" }).catch(() => {});
  if (child && child.exitCode === null) {
    try { await waitUntil(async () => child.exitCode, (value) => value !== null, "独立验收进程正常停止"); }
    catch { report.forcedStops++; child.kill(); await waitUntil(async () => child.exitCode, (value) => value !== null, "独立验收进程停止"); }
  }
  page = null;
}

async function main() {
  assert.ok(fs.readFileSync(executable).includes(Buffer.from(appId)), "只允许已固定的独立验收 EXE");
  assert.ok(sourceIndex.includes("com.wow.recorder.validation20261017"), "源索引必须来自既有隔离实战验收");
  const source = JSON.parse(fs.readFileSync(sourceIndex, "utf8"));
  assert.ok(Number.isSafeInteger(pullIndex) && pullIndex >= 0);
  const pull = source.pulls.filter((item) => item.importedSource && item.state === "ready" && item.timelineIndexed && item.timelineEvents.length > 100)[pullIndex];
  assert.ok(pull); assert.match(pull.pullId, /^[0-9a-f]{64}$/); assert.ok(pull.importedSource && fs.existsSync(pull.videoPath));
  let expectedCount = pull.timelineEvents.length, expectedKinds = null;
  if (auditDirectory) {
    const logFile = pull.logFileId.slice(0, pull.logFileId.lastIndexOf("#"));
    const audit = JSON.parse(fs.readFileSync(path.join(auditDirectory, `${path.parse(logFile).name}.json`), "utf8"));
    const encounter = audit.encounters.find((item) => item.startMs === pull.encounterStartUnixMs);
    assert.ok(encounter); expectedCount = encounter.timelineCount; expectedKinds = encounter.timelineKindCounts;
  }
  const sourceHls = path.dirname(pull.playbackPath), target = path.join(roaming, "recordings", pull.pullId);
  assert.equal(fs.existsSync(target), false, "避免覆盖已有隔离录像目录");
  const indexPath = path.join(roaming, "recording-index.json"), statePath = path.join(roaming, "client-state.json");
  const originals = [sourceIndex, pull.videoPath, ...fs.readdirSync(sourceHls).map((file) => path.join(sourceHls, file))];
  const originalHashes = originals.map(hash);
  const protectedPaths = ["target/debug/wow-recorder-client.exe", "target/release/wow-recorder-client.exe", "target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe"].map((file) => path.resolve(__dirname, "../src-tauri", file));
  const protectedHashes = protectedPaths.map(hash);
  fs.mkdirSync(path.join(output, "app"), { recursive: true }); fs.mkdirSync(path.join(output, "backup"), { recursive: true });
  fs.copyFileSync(executable, path.join(output, "app/wow-recorder-client.exe"));
  const backups = [indexPath, statePath].map((file) => ({ file, bytes: fs.readFileSync(file) }));
  for (const backup of backups) fs.writeFileSync(path.join(output, "backup", path.basename(backup.file)), backup.bytes);
  let deathReview = null;
  const controlledDirectories = [];
  try {
    fs.mkdirSync(path.join(target, "hls"), { recursive: true });
    for (const file of fs.readdirSync(sourceHls)) {
      assert.match(file, /^(index\.m3u8|init\.mp4|segment-\d{5}\.m4s)$/);
      fs.copyFileSync(path.join(sourceHls, file), path.join(target, "hls", file));
    }
    const selected = { ...pull, playbackPath: path.join(target, "hls/index.m3u8") };
    deathReview = process.argv.includes("--death-review") ? await prepareDeathReview({ selected, sourceIndex, output }) : null;
    for (const extra of deathReview?.extras ?? []) {
      const directory = path.join(roaming, "recordings", extra.pullId);
      assert.equal(fs.existsSync(directory), false, "控制视角不能覆盖已有目录");
      assert.ok(path.resolve(directory).startsWith(path.resolve(roaming, "recordings") + path.sep));
      assert.match(extra.pullId, /^[0-9a-f]{64}$/);
      controlledDirectories.push(directory); fs.mkdirSync(path.join(directory, "hls"), { recursive: true });
      for (const file of fs.readdirSync(sourceHls)) fs.copyFileSync(path.join(sourceHls, file), path.join(directory, "hls", file));
      extra.playbackPath = path.join(directory, "hls/index.m3u8");
    }
    fs.writeFileSync(indexPath, JSON.stringify({ schemaVersion: 2, activePull: null, pulls: [selected, ...(deathReview?.extras ?? [])], sources: [], diagnostics: [] }));
    fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, sections: { replay: { catalogSource: "local", selectedPullId: pull.pullId, bookmarksMs: { [pull.pullId]: 5000 }, offsetsMs: {}, muted: true, volume: 0, playbackRate: 1 } } }));
    await launch(); await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
    await waitUntil(() => invoke("list_local_recordings"), (rows) => {
      const entry = rows.find((item) => item.pullId === pull.pullId);
      return entry?.timelineComplete && entry.timelineEventCount === expectedCount;
    }, "真实事件索引完成", 60000);
    const expected = 5 + pull.mapping.videoZeroMs / 1000;
    await page.waitForFunction((expected) => { const video = document.querySelector("video[aria-label$='本地回放']"); return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - expected) < 0.2 && video.muted; }, expected);
    const events = []; let cursor = null, pages = 0;
    do {
      const result = await invoke("list_replay_events", { pullId: pull.pullId, cursor, limit: 1000 });
      assert.equal(result.reset, false); events.push(...result.events); cursor = result.nextCursor;
      assert.ok(++pages <= Math.ceil(expectedCount / 1000) + 1);
      if (!result.hasMore) break;
    } while (true);
    assert.equal(events.length, expectedCount);
    const ids = new Set(events.map((item) => item.eventId));
    assert.ok(pull.timelineEvents.every((item) => ids.has(item.eventId)), "升级不能丢失原事件稳定身份");
    const kinds = {}, levels = {};
    for (const item of events) {
      kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
      if (item.empowerLevel != null) levels[item.empowerLevel] = (levels[item.empowerLevel] ?? 0) + 1;
    }
    if (expectedKinds) assert.deepEqual(kinds, expectedKinds);
    if (process.argv.includes("--track-details")) report.trackDetails = await verifyNativeTrackDetails({ page, invoke, events, pullId: selected.pullId, output,
      restart: async (pendingHeight) => {
        report.trackConfigDirectory = await invoke("plugin:path|resolve_directory", { directory: 13 });
        const readPreferences = () => JSON.parse(fs.readFileSync(statePath, "utf8")).sections.replay;
        report.trackRestartBeforeClose = readPreferences();
        if (pendingHeight !== undefined) assert.notEqual(report.trackRestartBeforeClose.timelineTrackHeight, pendingHeight, "立即关闭场景必须覆盖尚未防抖落盘的修改");
        const forcedBefore = report.forcedStops;
        await close(); assert.equal(report.forcedStops, forcedBefore, "重启验收必须正常退出，不能依靠测试强杀"); report.trackRestartAfterClose = readPreferences();
        if (pendingHeight !== undefined) assert.equal(report.trackRestartAfterClose.timelineTrackHeight, pendingHeight, "正常关闭必须先写入最新快照");
        await launch(); report.trackRestartAfterLaunch = readPreferences(); return page;
      } });
    if (deathReview) report.deathReview = await verifyDeathReview({ page, invoke, selected, events, output, prepared: deathReview });
    report.indexUpgrade = { oldCount: pull.timelineEvents.length, currentCount: events.length, pages, kinds, empowerLevels: levels, originalEventIdsPreserved: true };
    await page.locator('[data-replay-track] button[draggable]').first().waitFor();
    const video = page.locator("video[aria-label$='本地回放']"); await video.evaluate((element) => element.pause());
    report.media = await video.evaluate((element) => ({ readyState: element.readyState, videoWidth: element.videoWidth, videoHeight: element.videoHeight, currentTime: element.currentTime, muted: element.muted, decodedFrames: element.getVideoPlaybackQuality().totalVideoFrames }));
    assert.ok(report.media.decodedFrames > 0); assert.ok(report.media.videoWidth >= 1280);
    await page.screenshot({ path: path.join(output, "native-real-workbench.png"), fullPage: true });
    await page.setViewportSize({ width: 1080, height: 720 });
    await page.screenshot({ path: path.join(output, "native-real-workbench-1080.png"), fullPage: true });
    report.viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); assert.equal(report.viewportOverflow, false);
    report.pullId = pull.pullId; report.eventCount = events.length; report.playerCount = pull.players.length; report.viewports = ["1440x900", "1080x720"];
    assert.deepEqual(report.pageErrors, []); report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = String(error.stack || error);
    if (page && !page.isClosed()) {
      report.runtime = await page.evaluate(() => {
        const video = document.querySelector("video[aria-label$='本地回放']");
        return { media: video ? { readyState: video.readyState, currentTime: video.currentTime, seeking: video.seeking, muted: video.muted, error: video.error?.message, duration: video.duration } : null,
          alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent) };
      }).catch(() => null);
      report.preferences = await invoke("get_replay_preferences").catch(() => null);
      if (process.argv.includes("--death-review")) report.recordings = await invoke("list_local_recordings").then((rows) => rows.map((row) => ({ id: row.pullId, state: row.state, mapping: row.mapping, error: row.error }))).catch(() => null);
      await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    }
    throw error;
  }
  finally {
    await Promise.allSettled(networkReads);
    if (report.network) for (const entry of report.network) {
      const file = path.join(sourceHls, entry.file);
      if (fs.existsSync(file)) entry.matchesOriginal = entry.sha256 === hash(file);
    }
    await close(); cleanupDeathFixtures(deathReview); for (const backup of backups) fs.writeFileSync(backup.file, backup.bytes);
    assert.ok(path.resolve(target).startsWith(path.resolve(roaming, "recordings") + path.sep)); assert.match(path.basename(target), /^[0-9a-f]{64}$/);
    fs.rmSync(target, { recursive: true, force: true });
    for (const directory of controlledDirectories) {
      assert.ok(path.resolve(directory).startsWith(path.resolve(roaming, "recordings") + path.sep));
      assert.match(path.basename(directory), /^[0-9a-f]{64}$/); fs.rmSync(directory, { recursive: true, force: true });
    }
    assert.deepEqual(originals.map(hash), originalHashes); assert.deepEqual(protectedPaths.map(hash), protectedHashes);
    report.originalFilesUnchanged = true; report.formalArtifactsUnchanged = true; report.isolatedStateRestored = backups.every((backup) => fs.readFileSync(backup.file).equals(backup.bytes)); report.processStopped = child?.exitCode !== null;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}
main().then(() => console.log("PASS 真实游戏录像工作台截图与只读现场保护")).catch((error) => { console.error(error); process.exitCode = 1; });
