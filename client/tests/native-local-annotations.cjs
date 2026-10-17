const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

// 本地标注只使用独立验收标识和合成录像，不启动云服务或正式应用。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const executable = path.resolve(argument("--exe"));
const fixture = JSON.parse(fs.readFileSync(path.join(argument("--fixture"), "fixture.json"), "utf8"));
const playwright = require(path.resolve(argument("--playwright")));
const appId = "com.wow.recorder.cloudvalidation20261017";
const roaming = path.join(process.env.APPDATA, appId);
const report = { cases: [], pageErrors: [], boundary: "真实 Rust IPC／LocalStateStore／WebView2／本地 HLS；隔离 AppData 与固定合成录像，无云服务，无正式应用写入" };
let child, page;
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });

async function launch() {
  const socket = net.createServer(); await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
  child = spawn(path.join(output, "app/wow-recorder-client.exe"), [], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling` } });
  for (const [stream, name] of [[child.stdout, "stdout.log"], [child.stderr, "stderr.log"]]) stream.on("data", (data) => fs.appendFileSync(path.join(output, name), data));
  let browser; const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { try { browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); } }
  assert.ok(browser, "原生 WebView2 未就绪"); page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && document.querySelector("nav"));
  assert.equal(await invoke("plugin:app|identifier"), appId, "禁止操作正式应用");
  await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
  await page.waitForFunction(() => { const video = document.querySelector("video[aria-label$='本地回放']"); return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 3) < 0.2; });
}

async function close() {
  if (page && !page.isClosed()) await invoke("plugin:window|close", { label: "main" }).catch(() => {});
  if (child && child.exitCode === null) { await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]); if (child.exitCode === null) child.kill(); }
  page = null;
}

async function main() {
  assert.ok(fs.readFileSync(executable).includes(Buffer.from(appId)), "必须使用已经固定的独立 cloudvalidation EXE");
  assert.equal(fixture.pullId, "0000000000000000000000000000000000000000000000000000000000000001", "只允许固定合成媒体");
  const protectedPaths = ["target/debug/wow-recorder-client.exe", "target/release/wow-recorder-client.exe", "target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe"].map((file) => path.resolve(__dirname, "../src-tauri", file));
  const protectedHashes = protectedPaths.map(hash);
  fs.mkdirSync(path.join(output, "app"), { recursive: true }); fs.copyFileSync(executable, path.join(output, "app/wow-recorder-client.exe"));
  const mediaRoot = path.join(roaming, "recordings", fixture.pullId); fs.mkdirSync(path.join(mediaRoot, "hls"), { recursive: true });
  const source = path.normalize(fixture.videoPath), sourceHash = hash(source), videoPath = path.join(mediaRoot, "synthetic.mp4"); fs.copyFileSync(source, videoPath);
  for (const file of fs.readdirSync(path.join(path.dirname(source), "hls"))) { assert.match(file, /^(index\.m3u8|init\.mp4|segment-\d{5}\.m4s)$/); fs.copyFileSync(path.join(path.dirname(source), "hls", file), path.join(mediaRoot, "hls", file)); }
  const pull = { ...fixture, state: "ready", error: null, videoPath, importedSource: videoPath, playbackPath: path.join(mediaRoot, "hls/index.m3u8") };
  fs.writeFileSync(path.join(roaming, "recording-index.json"), JSON.stringify({ schemaVersion: 2, activePull: null, pulls: [pull], sources: [], diagnostics: [] }));
  fs.writeFileSync(path.join(roaming, "client-state.json"), JSON.stringify({ schemaVersion: 1, sections: { replay: { catalogSource: "local", selectedPullId: pull.pullId, bookmarksMs: { [pull.pullId]: 1000 }, offsetsMs: {}, muted: true, volume: 0.5, playbackRate: 1 }, validationSentinel: { preserve: true } } }));
  const run = async (name, action) => { await action(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`); };
  let saved;
  try {
    await launch();
    await run("真实本地IPC空标注与实际鼠标非空箭头保存到LocalStateStore", async () => {
      const before = await invoke("get_local_replay_annotations", { pullId: pull.pullId }); assert.deepEqual(before, { version: 0, items: [], canEdit: true });
      await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
      const deadline = Date.now() + 10000;
      while (await page.getByRole("combobox", { name: "标注工具", exact: true }).isDisabled()) { assert.ok(Date.now() < deadline); await new Promise((resolve) => setTimeout(resolve, 100)); }
      const canvas = page.getByLabel("视频标注画布", { exact: true }), box = await canvas.boundingBox(); assert.ok(box?.width > 100);
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.6); await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8, { steps: 8 }); await page.mouse.up();
      await canvas.locator('[data-annotation-kind="arrow"]').waitFor(); await page.getByRole("button", { name: "保存标注", exact: true }).click();
      do { saved = await invoke("get_local_replay_annotations", { pullId: pull.pullId }); if (saved.version === 1) break; await new Promise((resolve) => setTimeout(resolve, 100)); } while (Date.now() < deadline);
      assert.equal(saved.version, 1); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].kind, "arrow"); assert.equal(saved.items[0].points.length, 2);
      assert.ok(Math.abs(saved.items[0].points[0].x - 0.25) < 0.01); assert.ok(Math.abs(saved.items[0].points[1].x - 0.5) < 0.01);
      const disk = JSON.parse(fs.readFileSync(path.join(roaming, "client-state.json"), "utf8")).sections;
      assert.equal(disk.replayAnnotations[pull.pullId].version, 1); assert.deepEqual(disk.replayAnnotations[pull.pullId].items, saved.items); assert.deepEqual(disk.validationSentinel, { preserve: true });
      report.snapshot = saved; report.stateSection = "replayAnnotations";
    });
    await close(); await launch();
    await run("独立原生进程重启恢复非空本地标注并实际渲染SVG箭头", async () => {
      const restored = await invoke("get_local_replay_annotations", { pullId: pull.pullId }); assert.deepEqual(restored, saved);
      await page.locator(`[data-annotation-id="${saved.items[0].id}"][data-annotation-kind="arrow"] line`).waitFor();
      await page.screenshot({ path: path.join(output, "native-local-arrow-restarted.png"), fullPage: true });
      assert.equal(hash(source), sourceHash); assert.equal(hash(videoPath), sourceHash); assert.deepEqual(report.pageErrors, []);
      report.svgRenderedAfterRestart = true;
    });
    await run("原生预滚尾滚隐藏标注禁绘制，回到战斗画面恢复且快照不变", async () => {
      await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
      const tool = page.getByRole("combobox", { name: "标注工具", exact: true });
      for (const seconds of [0.5, 13.5]) {
        await page.locator("video").evaluate((video, seconds) => { video.pause(); video.currentTime = seconds; }, seconds);
        await page.waitForFunction((seconds) => { const video = document.querySelector("video"); return !video.seeking && Math.abs(video.currentTime - seconds) < 0.1 && !document.querySelector("[data-annotation-canvas]"); }, seconds);
        assert.equal(await tool.isDisabled(), true); assert.equal(await page.locator("[data-annotation-id]").count(), 0);
        assert.deepEqual(await invoke("get_local_replay_annotations", { pullId: pull.pullId }), saved);
      }
      await page.locator("video").evaluate((video) => { video.currentTime = 3; });
      await page.waitForFunction(() => { const video = document.querySelector("video"); return !video.seeking && Math.abs(video.currentTime - 3) < 0.1 && !!document.querySelector("[data-annotation-canvas] [data-annotation-kind='arrow']"); });
      assert.equal(await tool.isDisabled(), false); assert.deepEqual(await invoke("get_local_replay_annotations", { pullId: pull.pullId }), saved);
      const disk = JSON.parse(fs.readFileSync(path.join(roaming, "client-state.json"), "utf8")).sections.replayAnnotations[pull.pullId];
      assert.equal(disk.version, saved.version); assert.deepEqual(disk.items, saved.items); assert.deepEqual(report.pageErrors, []);
      report.frameBoundaryGuard = { preRollVideoSeconds: 0.5, tailRollVideoSeconds: 13.5, restoredVideoSeconds: 3, snapshotsUnchanged: true };
    });
    report.passed = true;
  } catch (error) { report.passed = false; report.failure = String(error.stack || error); if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {}); throw error; }
  finally { await close(); assert.deepEqual(protectedPaths.map(hash), protectedHashes); report.formalArtifactsUnchanged = true; report.processStopped = child?.exitCode !== null; fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
