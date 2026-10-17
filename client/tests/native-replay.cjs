const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

// 只允许运行以独立标识构建的验收程序，真实 IPC 和本地协议均不替换。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const root = path.resolve(argument("--output"));
const fixtureRoot = path.resolve(argument("--fixture"));
const executable = path.resolve(argument("--exe"));
const playwright = require(path.resolve(argument("--playwright")));
const appId = "com.wow.recorder.validation20261017";
const roaming = path.join(process.env.APPDATA, appId);
const local = path.join(process.env.LOCALAPPDATA, appId);
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "fixture.json"), "utf8"));
const realSampleRoot = process.env.WOW_REPLAY_REAL_SAMPLE_DIR;
const report = { cases: [], pageErrors: [], boundary: "独立应用标识；真实 Tauri IPC / WebView2 / 本地协议；合成媒体" };
let child, browser, page;

async function launch() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  child = spawn(path.join(root, "app/wow-recorder-client.exe"), [], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling` },
  });
  child.stdout.on("data", (data) => fs.appendFileSync(path.join(root, "stdout.log"), data));
  child.stderr.on("data", (data) => fs.appendFileSync(path.join(root, "stderr.log"), data));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  assert.ok(browser, "WebView2 调试端点未就绪");
  const context = browser.contexts()[0];
  page = context.pages()[0] || await context.waitForEvent("page");
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && document.querySelector("nav"));
  const id = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:app|identifier"));
  assert.equal(id, appId, "禁止操作正式用户应用");
  await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
}

async function close() {
  if (page && !page.isClosed()) {
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
  }
  if (child && child.exitCode === null) {
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (child.exitCode === null) child.kill();
  }
  browser = null; page = null;
}

async function main() {
  assert.ok(fs.readFileSync(executable).includes(Buffer.from(appId)), "必须先以独立验收标识构建；禁止启动正式用户程序");
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  // 验收程序所在目录不放 OBS，避免后台守护启动正式录制运行时。
  fs.copyFileSync(executable, path.join(root, "app/wow-recorder-client.exe"));
  fs.mkdirSync(roaming, { recursive: true }); fs.mkdirSync(local, { recursive: true });
  const recordingRoot = path.join(roaming, "recordings", path.basename(path.dirname(fixture.videoPath)));
  console.log("准备独立原生验收媒体");
  const copy = (source, target) => {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.isDirectory()) copy(path.join(source, entry.name), path.join(target, entry.name));
      else fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
    }
  };
  copy(path.dirname(path.normalize(fixture.videoPath)), recordingRoot);
  console.log("写入独立验收索引");
  fixture.videoPath = path.join(recordingRoot, path.basename(fixture.videoPath));
  fixture.playbackPath = path.join(recordingRoot, "hls/index.m3u8");
  fixture.state = "failed"; fixture.error = "验收播放产物处理失败";
  fs.writeFileSync(path.join(roaming, "recording-index.json"), JSON.stringify({ schemaVersion: 1, activePull: null, pulls: [fixture], sources: [], diagnostics: [] }));
  fs.writeFileSync(path.join(roaming, "client-state.json"), JSON.stringify({ schemaVersion: 1, sections: {
    replay: { selectedPullId: fixture.pullId, bookmarksMs: {}, offsetsMs: {}, volume: 0.5, muted: true, playbackRate: 1, eventKinds: [], actorGuid: null },
    validationSentinel: { preserve: true },
  } }));
  const run = async (name, fn) => { await fn(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
  try {
    await launch();
    await run("原生失败任务幂等重试并复用有效 MP4", async () => {
      await page.evaluate((pullId) => Promise.all([
        window.__TAURI_INTERNALS__.invoke("retry_recording_processing", { pullId }),
        window.__TAURI_INTERNALS__.invoke("retry_recording_processing", { pullId }),
      ]), fixture.pullId);
      await page.waitForFunction(() => { const video = document.querySelector("video[aria-label$='本地回放']"); return video && video.readyState >= 2; });
      assert.equal(JSON.parse(fs.readFileSync(path.join(roaming, "recording-index.json"))).pulls[0].state, "ready");
    });
    await run("原生索引 v1 备份迁移与受控 HLS 播放", async () => {
      await page.waitForFunction(() => { const video = document.querySelector("video[aria-label$='本地回放']"); return video && video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 2) < 0.15; });
      assert.equal(JSON.parse(fs.readFileSync(path.join(roaming, "recording-index.json"))).schemaVersion, 2);
      assert.equal(JSON.parse(fs.readFileSync(path.join(roaming, "recording-index.v1.json"))).schemaVersion, 1);
    });
    await run("原生录像摘要与完整事件分页契约", async () => {
      const result = await page.evaluate(async (pullId) => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const summary = (await invoke("list_local_recordings")).find((item) => item.pullId === pullId);
        const events = [];
        let cursor = null;
        let pages = 0;
        let revision;
        do {
          const page = await invoke("list_replay_events", { pullId, cursor, limit: 1 });
          if (page.reset || page.events.length > 1) throw new Error("分页发生非预期重置或超出上限");
          events.push(...page.events); cursor = page.nextCursor; revision = page.revision;
          if (++pages > summary.timelineEventCount + 1) throw new Error("事件分页游标没有结束");
          if (!page.hasMore) break;
        } while (true);
        const tail = await invoke("list_replay_events", { pullId, cursor, limit: 1 });
        let invalidLimitRejected = false;
        try { await invoke("list_replay_events", { pullId, cursor: null, limit: 1001 }); }
        catch { invalidLimitRejected = true; }
        return { summary, events, revision, tail, invalidLimitRejected };
      }, fixture.pullId);
      assert.equal(Object.hasOwn(result.summary, "timelineEvents"), false);
      assert.equal(result.summary.timelineEventCount, fixture.timelineEvents.length);
      assert.equal(result.revision, result.summary.timelineRevision);
      assert.deepEqual(result.events, [...fixture.timelineEvents].sort((left, right) => left.pullTimeMs - right.pullTimeMs));
      assert.equal(result.tail.events.length, 0);
      assert.equal(result.tail.hasMore, false);
      assert.equal(result.tail.reset, false);
      assert.equal(result.invalidLimitRejected, true);
    });
    await run("原生旧偏好补齐时间轴外观默认值", async () => {
      const preferences = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_replay_preferences"));
      assert.equal(preferences.timelineTrackHeight, 30);
      assert.equal(preferences.timelineIconPercent, 80);
      assert.equal(preferences.timelineZoom, 1);
      assert.equal(preferences.volume, 0.5);
      assert.equal(preferences.muted, true);
    });
    await run("原生技能查询、图片协议与路径限制", async () => {
      const result = await page.evaluate(async () => {
        const metadata = await window.__TAURI_INTERNALS__.invoke("get_spell_metadata", { spellIds: [642, 17] });
        const image = await fetch(metadata.find((record) => record.spellId === 642).iconUrl);
        const blocked = await fetch("http://spell-icon.localhost/..%2Fa.jpg");
        return { count: metadata.length, ok: image.ok, contentType: image.headers.get("content-type"), blocked: blocked.status };
      });
      assert.equal(result.count, 2); assert.equal(result.ok, true); assert.equal(result.contentType, "image/jpeg"); assert.ok(result.blocked >= 400);
      await page.locator("img[alt='圣盾术']").waitFor();
    });
    await run("原生千项技能分批查询与全部随包图片协议摘要", async () => {
      const resourceRoot = path.resolve(__dirname, "../src-tauri/resources/game-data");
      const pack = JSON.parse(fs.readFileSync(path.join(resourceRoot, "spells.json"), "utf8"));
      const manifest = JSON.parse(fs.readFileSync(path.join(resourceRoot, "manifest.json"), "utf8"));
      const expected = Object.fromEntries(manifest.files.filter((record) => record.file.startsWith("icons/")).map((record) => [path.basename(record.file), record.sha256]));
      const result = await page.evaluate(async ({ spellIds, expected }) => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const metadata = [];
        for (let offset = 0; offset < spellIds.length; offset += 256) {
          metadata.push(...await invoke("get_spell_metadata", { spellIds: spellIds.slice(offset, offset + 256) }));
        }
        if (metadata.some((record) => !record.iconUrl)) throw new Error("随包技能出现缺失的原生图片地址");
        const metadataUrls = new Set(metadata.map((record) => record.iconUrl));
        // 清单还保留一张已被新版技能引用替换的初始图片，协议也需能读取该资源。
        const urls = [...new Set([...metadataUrls, ...Object.keys(expected).map((name) => `http://spell-icon.localhost/${name}`)])];
        let next = 0;
        await Promise.all(Array.from({ length: 8 }, async () => {
          while (next < urls.length) {
            const url = urls[next++];
            const response = await fetch(url);
            if (!response.ok || response.headers.get("content-type") !== "image/jpeg") throw new Error(`原生图标协议读取失败：${url}`);
            const bytes = await response.arrayBuffer();
            const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
            if (digest !== expected[url.split("/").at(-1)]) throw new Error(`原生图标协议摘要不一致：${url}`);
          }
        }));
        let oversizedRejected = false;
        try { await invoke("get_spell_metadata", { spellIds: Array.from({ length: 513 }, () => 642) }); }
        catch { oversizedRejected = true; }
        return { metadata: metadata.length, metadataImages: metadataUrls.size, images: urls.length, oversizedRejected };
      }, { spellIds: pack.spells.map((record) => record.spellId), expected });
      assert.equal(result.metadata, pack.spells.length);
      assert.equal(result.metadataImages, new Set(pack.spells.map((record) => record.icon)).size);
      assert.equal(result.images, Object.keys(expected).length);
      assert.equal(result.oversizedRejected, true);
      report.bundledSkills = { ...result, sha256Matched: true };
    });
    await run("原生资料导入与设置写盘", async () => {
      const importPath = path.join(root, "wcl-masterdata.json");
      fs.writeFileSync(importPath, JSON.stringify({ masterData: { abilities: [{ id: 9, gameID: 642, name: "圣盾术", icon: "spell_holy_divineshield.jpg" }] } }));
      const count = await page.evaluate((file) => window.__TAURI_INTERNALS__.invoke("import_spell_metadata", { path: file }), importPath);
      assert.ok(count >= 13); assert.ok(fs.existsSync(path.join(local, "game-data/spells.json")));
      const axis = page.getByRole("slider", { name: "跳转到敌方技能时间" });
      await axis.focus(); await page.keyboard.press("Home");
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => Math.abs(document.querySelector("video[aria-label$='本地回放']").currentTime - 3) < 0.15);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const saved = JSON.parse(fs.readFileSync(path.join(roaming, "client-state.json")));
        if (saved.sections.replay.bookmarksMs[fixture.pullId] >= 900) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const saved = JSON.parse(fs.readFileSync(path.join(roaming, "client-state.json")));
      assert.ok(saved.sections.replay.bookmarksMs[fixture.pullId] >= 900);
      assert.equal(saved.sections.replay.timelineTrackHeight, 30);
      assert.equal(saved.sections.replay.timelineIconPercent, 80);
      assert.equal(saved.sections.replay.timelineZoom, 1);
      assert.equal(saved.sections.validationSentinel.preserve, true);
      await page.screenshot({ path: path.join(root, "native.png"), fullPage: true });
    });
    await close();
    await run("原生进程重启后恢复书签和媒体参数", async () => {
      await launch();
      await page.waitForFunction(() => { const video = document.querySelector("video[aria-label$='本地回放']"); return video && video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 3) < 0.15 && video.muted && video.volume === 0.5; });
    });
    if (realSampleRoot) {
      const inventory = JSON.parse(fs.readFileSync(path.join(realSampleRoot, "inventory.json"), "utf8"));
      const selected = [0, 1, 4].map((index) => inventory.videos[index]);
      const normalize = (value) => path.normalize(value).replace(/^\\\\\?\\/, "").toLowerCase();
      const originals = [...inventory.logs.map((item) => item.file), ...selected.flatMap((video) => [
        path.join(video.folder, "metadata.json"), video.media[0].file,
      ])];
      const before = originals.map((file) => { const stat = fs.statSync(file); return { file, bytes: stat.size, mtimeMs: stat.mtimeMs }; });
      const request = {
        directory: path.dirname(selected[0].folder),
        logPaths: inventory.logs.map((item) => item.file),
        recordingIds: selected.map((item) => item.metadata.id),
      };
      const waitForImport = async () => {
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
          const task = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_recording_import"));
          if (["completed", "failed", "cancelled"].includes(task.status)) return task;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error("真实录像原生导入任务超过 180 秒未结束");
      };
      let imported = [];
      await run("原生后台任务只读导入三场真实战斗并分页查询", async () => {
        const initial = await page.evaluate((request) => window.__TAURI_INTERNALS__.invoke("start_recording_import", { request }), request);
        assert.ok(initial.taskId);
        const result = await waitForImport();
        assert.equal(result.taskId, initial.taskId);
        assert.equal(result.status, "completed", JSON.stringify(result));
        assert.equal(result.importedCount, 3, JSON.stringify(result));
        assert.equal(result.failedCount, 0, JSON.stringify(result));
        assert.equal(result.skippedCount, 0, JSON.stringify(result));
        const summaries = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_local_recordings"));
        imported = summaries.filter((item) => item.importedSource);
        assert.equal(imported.length, 3);
        const evidence = [];
        for (const video of selected) {
          const recording = imported.find((item) => normalize(item.importedSource) === normalize(video.media[0].file));
          assert.ok(recording, "实际原片未出现在导入摘要中");
          assert.equal(recording.encounterId, video.metadata.encounter.id);
          assert.equal(recording.encounterStartUnixMs, video.metadata.startTime);
          assert.equal(recording.encounterEndUnixMs, video.metadata.endTime);
          assert.equal(recording.difficultyId, 16, "旁车难度5必须映射到日志难度16");
          assert.equal(recording.battleKey, `wcl:${video.metadata.serverFight.reportCode}:${video.metadata.serverFight.fightId}`);
          assert.match(recording.recordingPlayerGuid, /^Player-/);
          const viewer = recording.players.find((player) => player.guid === recording.recordingPlayerGuid);
          assert.ok(viewer);
          assert.equal(viewer.actorId, video.metadata.actorId);
          assert.equal(recording.mapping.mediaCalibrated, false, "外部录像偏移不得冒充媒体时钟精确校准");
          const events = await page.evaluate(async (pullId) => {
            const events = []; let cursor = null;
            for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
              const result = await window.__TAURI_INTERNALS__.invoke("list_replay_events", { pullId, cursor, limit: 1000 });
              if (result.reset) throw new Error("已结束战斗事件读取期间发生意外版本重置");
              events.push(...result.events); cursor = result.nextCursor;
              if (!result.hasMore) return events;
            }
            throw new Error("真实事件分页未在合理页数内结束");
          }, recording.pullId);
          assert.equal(events.length, recording.timelineEventCount);
          assert.ok(events.length > 500);
          assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
          assert.ok(events.every((event, index) => index === 0 || event.pullTimeMs >= events[index - 1].pullTimeMs));
          const own = events.filter((event) => event.owner === "player");
          assert.ok(own.length > 0);
          assert.ok(own.every((event) => (event.kind === "death" || /^(buff|debuff)/.test(event.kind) ? event.targetGuid : event.sourceGuid) === recording.recordingPlayerGuid));
          evidence.push({ pullId: recording.pullId, events: events.length, ownEvents: own.length, difficultyId: recording.difficultyId,
            battleKeyPresent: !!recording.battleKey, viewerGuidMatched: true });
        }
        report.realImport = { progress: result, recordings: evidence };
      });
      await run("原生真实导入三份HLS就绪并使用本地协议播放", async () => {
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
          const summaries = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_local_recordings"));
          imported = summaries.filter((item) => item.importedSource);
          const failed = imported.find((item) => item.state === "failed");
          assert.ok(!failed, failed?.error);
          if (imported.length === 3 && imported.every((item) => item.state === "ready" && item.playbackPath)) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        assert.ok(imported.every((item) => item.state === "ready" && item.playbackPath), "真实导入 HLS 未全部就绪");
        for (const recording of imported) {
          assert.ok(normalize(recording.playbackPath).startsWith(normalize(path.join(roaming, "recordings")) + path.sep));
          assert.ok(fs.readFileSync(recording.playbackPath, "utf8").includes("#EXT-X-ENDLIST"));
        }
        const selectedRecording = imported.find((item) => item.encounterStartUnixMs === selected[0].metadata.startTime);
        await page.evaluate(async (pullId) => {
          const preferences = await window.__TAURI_INTERNALS__.invoke("get_replay_preferences");
          await window.__TAURI_INTERNALS__.invoke("set_replay_preferences", { preferences: { ...preferences, selectedPullId: pullId, muted: true } });
        }, selectedRecording.pullId);
        const mediaResponse = page.waitForResponse((response) => response.url().includes(`local-replay.localhost/${selectedRecording.pullId}/index.m3u8`));
        await page.reload();
        await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && document.querySelector("nav"));
        await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
        assert.ok((await mediaResponse).ok(), "没有实际读取选中真实录像的原生 HLS 协议");
        await page.waitForFunction(() => {
          const video = document.querySelector("video[aria-label$='本地回放']");
          return video && video.readyState >= 2 && !video.seeking && video.currentTime >= 3;
        });
        await page.locator("video[aria-label$='本地回放']").evaluate((video) => { video.muted = true; return video.play(); });
        await page.waitForFunction(() => document.querySelector("video[aria-label$='本地回放']").currentTime > 3.8);
        await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.pause());
        report.realImport.readyHlsCount = imported.length;
        report.realImport.actualNativePlayback = true;
      });
      await run("原生真实导入重复请求幂等并保持用户原文件属性", async () => {
        await page.evaluate((request) => window.__TAURI_INTERNALS__.invoke("start_recording_import", { request }), request);
        const repeated = await waitForImport();
        assert.equal(repeated.status, "completed", JSON.stringify(repeated));
        assert.equal(repeated.importedCount, 0);
        assert.equal(repeated.skippedCount, 3);
        assert.equal(repeated.failedCount, 0);
        const summaries = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_local_recordings"));
        assert.equal(summaries.filter((item) => item.importedSource).length, 3);
        const after = originals.map((file) => { const stat = fs.statSync(file); return { file, bytes: stat.size, mtimeMs: stat.mtimeMs }; });
        assert.deepEqual(after, before);
        report.realImport.originalFilePropertiesUnchanged = true;
        fs.writeFileSync(path.join(root, "real-source-properties.json"), JSON.stringify({ before, after }, null, 2));
      });
    } else {
      report.realImport = { skipped: "未显式指定 WOW_REPLAY_REAL_SAMPLE_DIR，未访问真实用户录像或日志" };
    }
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = String(error.stack || error);
    if (page) await page.screenshot({ path: path.join(root, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await close();
    fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
