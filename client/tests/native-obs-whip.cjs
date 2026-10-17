const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");

// 仅复制官方公共运行时；不读取原 OBS config，不下载或升级，不采集屏幕／麦克风。
const argument = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const clientRoot = path.resolve(__dirname, "..");
const output = path.resolve(argument("--output", path.join(os.tmpdir(), `wow-obs-whip-${randomUUID()}`)));
assert.ok(output.startsWith(path.resolve(os.tmpdir()) + path.sep), "输出必须位于系统 TEMP 的独立目录");
assert.ok(!fs.existsSync(output), "输出目录必须尚未存在，防止覆盖其他验收现场");
const sourceObs = path.resolve(argument("--obs", path.join(clientRoot, "src-tauri/target/debug/obs")));
const ffmpeg = path.join(clientRoot, "src-tauri/resources/ffmpeg-runtime/bin/ffmpeg.exe");
const ffprobe = path.join(clientRoot, "src-tauri/resources/ffmpeg-runtime/probe/bin/ffprobe.exe");
const mediamtx = path.join(clientRoot, "src-tauri/resources/media-runtime/mediamtx.exe");
const playwright = require(path.resolve(argument("--playwright")));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [], peers = new Set();
const report = { cases: [], errors: [], boundary: "独立便携 OBS、合成色条／正弦音频、真实 WHIP/WHEP/HLS 和本地录像；不代表真实 WoW 捕捉或硬件矩阵", startedAt: new Date().toISOString() };
let obs, media, rpc, browser, page, server;

function run(exe, args, timeout = 30000) {
  const result = spawnSync(exe, args, { windowsHide: true, timeout, encoding: "utf8", maxBuffer: 4 * 1024 ** 2 });
  assert.equal(result.status, 0, `${path.basename(exe)} 未成功：${result.stderr || result.error || ""}`);
  return result.stdout;
}

function files(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), "不复制链接到其他目录的运行时文件");
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...files(filename));
    else if (entry.isFile()) result.push(filename);
  }
  return result;
}

function inventory(root) {
  return ["bin", "data", "obs-plugins"].flatMap((name) => files(path.join(root, name))).map((filename) => ({
    file: path.relative(root, filename), bytes: fs.statSync(filename).size,
    sha256: createHash("sha256").update(fs.readFileSync(filename)).digest("hex"),
  })).sort((a, b) => a.file.localeCompare(b.file));
}

async function port() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const value = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return value;
}

function start(exe, args, name, cwd) {
  const stream = fs.openSync(path.join(output, `${name}.log`), "w");
  const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ["ignore", stream, stream] });
  fs.closeSync(stream);
  children.push(child);
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5000)]);
  assert.ok(child.exitCode !== null || child.signalCode !== null, "自己启动的进程未退出");
}

async function eventually(check, label, milliseconds = 30000) {
  const deadline = Date.now() + milliseconds;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error.message; }
    assert.ok(!obs || obs.exitCode === null, "隔离 OBS 已提前退出");
    await delay(200);
  }
  throw new Error(`${label}超时${last ? `：${last}` : ""}`);
}

class ObsSocket {
  constructor(socket) {
    this.socket = socket; this.pending = new Map(); this.events = []; this.sequence = 0;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.op === 5) this.events.push({ type: message.d.eventType, data: message.d.eventData });
      if (message.op !== 7) return;
      const request = this.pending.get(message.d.requestId);
      if (!request) return;
      this.pending.delete(message.d.requestId); clearTimeout(request.timer);
      if (message.d.requestStatus.result) request.resolve(message.d.responseData || {});
      else request.reject(new Error(`OBS ${message.d.requestType}：${message.d.requestStatus.code} ${message.d.requestStatus.comment || ""}`));
    });
  }
  static async connect(address, password) {
    const socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new Error("OBS WebSocket 连接超时")); }, 3000);
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("OBS WebSocket 尚未监听")); }, { once: true });
      socket.addEventListener("message", ({ data }) => {
        const message = JSON.parse(data);
        if (message.op === 0) {
          const auth = message.d.authentication;
          const identify = { rpcVersion: 1, eventSubscriptions: 64 | 128 | 256 | 512 };
          if (auth) {
            const secret = createHash("sha256").update(password + auth.salt).digest("base64");
            identify.authentication = createHash("sha256").update(secret + auth.challenge).digest("base64");
          }
          socket.send(JSON.stringify({ op: 1, d: identify }));
        } else if (message.op === 2) { clearTimeout(timeout); resolve(); }
      });
    });
    return new ObsSocket(socket);
  }
  call(requestType, requestData = {}) {
    const requestId = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`OBS ${requestType} 响应超时`)); }, 15000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }
  close() { this.socket.close(); }
}

async function recordCase(name, action) {
  const detail = await action();
  report.cases.push({ name, passed: true, detail });
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`PASS ${name}`);
}

async function main() {
  const active = run("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process obs64,obs32,Wow -ErrorAction SilentlyContinue).Count"]);
  assert.equal(Number(active.trim()), 0, "存在真实 OBS／WoW，停止本轮独立验收");
  for (const filename of [ffmpeg, ffprobe, mediamtx, path.join(sourceObs, "bin/64bit/obs64.exe")]) assert.ok(fs.existsSync(filename), "缺少既有二进制");
  const before = inventory(sourceObs);
  const size = before.reduce((total, file) => total + file.bytes, 0);
  const space = fs.statfsSync(os.tmpdir());
  assert.ok(space.bavail * space.bsize > size + 2 * 1024 ** 3, "TEMP 空间不足以隔离 OBS 与测试产物");
  fs.mkdirSync(output);
  const root = path.join(output, "obs"), config = path.join(root, "config/obs-studio");
  fs.mkdirSync(root);
  for (const name of ["bin", "data", "obs-plugins"]) fs.cpSync(path.join(sourceObs, name), path.join(root, name), { recursive: true });
  assert.deepEqual(inventory(root), before, "隔离运行时复制摘要不一致");
  fs.writeFileSync(path.join(output, "runtime-inventory.json"), JSON.stringify(before, null, 2));
  fs.writeFileSync(path.join(root, "portable_mode.txt"), "");
  const profile = "SyntheticValidation", scene = "SyntheticScene";
  const profileDir = path.join(config, "basic/profiles", profile), sceneDir = path.join(config, "basic/scenes");
  const wsDir = path.join(config, "plugin_config/obs-websocket"), recordings = path.join(output, "recordings");
  for (const directory of [profileDir, sceneDir, wsDir, recordings]) fs.mkdirSync(directory, { recursive: true });
  const wsPort = await port(), hlsPort = await port(), rtcPort = await port(), udpPort = await port(), tcpPort = await port();
  const password = randomBytes(32).toString("base64url");
  fs.writeFileSync(path.join(wsDir, "config.json"), JSON.stringify({ alerts_enabled: false, auth_required: true, first_load: false,
    server_enabled: true, server_password: password, server_port: wsPort }));
  const global = `[General]\nFirstRun=true\nLastVersion=537002240\nEnableAutoUpdates=false\nLanguage=en-US\n[Basic]\nProfile=${profile}\nProfileDir=${profile}\nSceneCollection=${profile}\nSceneCollectionFile=${profile}\nConfigOnNewProfile=false\n[BasicWindow]\nWarnBeforeStartingStream=false\nWarnBeforeStoppingStream=false\nWarnBeforeStoppingRecord=false\nSysTrayEnabled=true\nSysTrayWhenStarted=true\n`;
  for (const name of ["global.ini", "user.ini"]) fs.writeFileSync(path.join(config, name), global);
  fs.writeFileSync(path.join(profileDir, "basic.ini"), `[General]\nName=${profile}\n[Video]\nBaseCX=640\nBaseCY=360\nOutputCX=640\nOutputCY=360\nFPSType=0\nFPSCommon=30\nColorFormat=NV12\nColorSpace=709\nColorRange=Partial\n[Audio]\nSampleRate=48000\nChannelSetup=Stereo\nDesktopDevice1=disabled\nDesktopDevice2=disabled\nAuxDevice1=disabled\nAuxDevice2=disabled\nAuxDevice3=disabled\nAuxDevice4=disabled\n[Output]\nMode=Advanced\nFilenameFormatting=synthetic-%CCYY-%MM-%DD-%hh-%mm-%ss\n[AdvOut]\nEncoder=obs_x264\nAudioEncoder=ffmpeg_opus\nTrackIndex=1\nRecType=Standard\nRecFilePath=${recordings.replaceAll("\\", "/")}\nRecFormat2=mkv\nRecEncoder=obs_x264\nRecAudioEncoder=ffmpeg_aac\nRecTracks=1\nTrack1Bitrate=128\nRecSplitFile=true\nRecSplitFileType=Manual\n`);
  const encoder = { bitrate: 1500, keyint_sec: 2, rate_control: "CBR", profile: "baseline", preset: "ultrafast", tune: "zerolatency", bf: 0 };
  for (const name of ["streamEncoder.json", "recordEncoder.json"]) fs.writeFileSync(path.join(profileDir, name), JSON.stringify(encoder));
  fs.writeFileSync(path.join(sceneDir, `${profile}.json`), JSON.stringify({ name: profile, current_scene: scene, current_program_scene: scene,
    scene_order: [{ name: scene }], sources: [{ name: scene, uuid: randomUUID(), id: "scene", versioned_id: "scene", settings: { items: [] } }], groups: [],
    DesktopAudioDevice1: null, DesktopAudioDevice2: null, AuxAudioDevice1: null, AuxAudioDevice2: null, AuxAudioDevice3: null, AuxAudioDevice4: null }));
  const source = path.join(output, "unique-synthetic.mp4");
  const encoders = run(ffmpeg, ["-hide_banner", "-encoders"]);
  run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "12", "-vf", "format=yuv420p", "-af", "volume=0.05", "-c:v", encoders.includes("libx264") ? "libx264" : "libopenh264", "-g", "60", "-b:v", "1200k", "-c:a", "aac", source]);
  report.fixtureSha256 = createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  const mediaConfig = path.join(output, "mediamtx.yml");
  fs.writeFileSync(mediaConfig, `logLevel: warn\napi: false\nmetrics: false\npprof: false\nplayback: false\nrtsp: false\nrtmp: false\nsrt: false\nhls: true\nhlsAddress: 127.0.0.1:${hlsPort}\nhlsAlwaysRemux: true\nhlsVariant: fmp4\nhlsSegmentCount: 30\nhlsSegmentDuration: 2s\nhlsDirectory: '${path.join(output, "history").replaceAll("\\", "/")}'\nwebrtc: true\nwebrtcAddress: 127.0.0.1:${rtcPort}\nwebrtcLocalUDPAddress: 127.0.0.1:${udpPort}\nwebrtcLocalTCPAddress: 127.0.0.1:${tcpPort}\nwebrtcIPsFromInterfaces: false\nwebrtcAdditionalHosts: [127.0.0.1]\nwebrtcTrackGatherTimeout: 15s\npaths:\n  synthetic:\n    source: publisher\n`);
  const bootMedia = () => start(mediamtx, [mediaConfig], `mediamtx-${children.length}`);
  media = bootMedia();
  const exe = path.join(root, "bin/64bit/obs64.exe");
  obs = start(exe, ["--portable", "--multi", "--disable-updater", "--disable-missing-files-check", "--only-bundled-plugins", "--minimize-to-tray", "--profile", profile, "--collection", profile, "--websocket_ipv4_only"], "obs", path.dirname(exe));
  rpc = await eventually(async () => ObsSocket.connect(`ws://127.0.0.1:${wsPort}`, password), "OBS WebSocket", 45000);
  // WebSocket 认证成功可能早于前端加载完成，此时 207 是瞬时状态，不能当插件不支持。
  await eventually(async () => rpc.call("GetVersion"), "OBS 前端初始化", 15000);
  await recordCase("独立 OBS 版本、空设备和合成源", async () => {
    const version = await rpc.call("GetVersion");
    assert.match(version.obsVersion, /^32\.2\.1/);
    const special = await rpc.call("GetSpecialInputs");
    assert.ok(Object.values(special).every((value) => value === null), "禁止存在真实桌面／麦克风输入");
    await rpc.call("SetVideoSettings", { baseWidth: 640, baseHeight: 360, outputWidth: 640, outputHeight: 360, fpsNumerator: 30, fpsDenominator: 1 });
    const created = await rpc.call("CreateInput", { sceneName: scene, inputName: "OnlySyntheticFixture", inputKind: "ffmpeg_source", sceneItemEnabled: true,
      inputSettings: { is_local_file: true, local_file: source, looping: true, restart_on_activate: true, hw_decode: false, clear_on_media_end: false } });
    await rpc.call("SetInputAudioMonitorType", { inputName: "OnlySyntheticFixture", monitorType: "OBS_MONITORING_TYPE_NONE" });
    const inputs = await rpc.call("GetInputList");
    assert.deepEqual(inputs.inputs.map((input) => input.inputKind), ["ffmpeg_source"]);
    report.obsVersion = version.obsVersion; report.websocketVersion = version.obsWebSocketVersion;
    return { obsVersion: version.obsVersion, inputs: inputs.inputs.map((input) => input.inputKind), sceneItemId: created.sceneItemId, runtimeBytes: size };
  });
  await recordCase("OBS 原生 WHIP 服务与同时本地录像", async () => {
    await rpc.call("SetStreamServiceSettings", { streamServiceType: "whip_custom", streamServiceSettings: { server: `http://127.0.0.1:${rtcPort}/synthetic/whip`, bearer_token: "" } });
    assert.equal((await rpc.call("GetStreamServiceSettings")).streamServiceType, "whip_custom");
    await rpc.call("StartRecord");
    await eventually(async () => (await rpc.call("GetRecordStatus")).outputActive, "OBS 正式录像");
    await rpc.call("StartStream");
    await eventually(async () => { const status = await rpc.call("GetStreamStatus"); return status.outputActive && status.outputBytes > 10000 && status; }, "OBS WHIP 字节输出");
    return { recordingActive: true, streamServiceType: "whip_custom" };
  });
  server = http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.url === "/hls.mjs") { response.setHeader("Content-Type", "text/javascript"); fs.createReadStream(path.join(clientRoot, "node_modules/hls.js/dist/hls.mjs")).pipe(response); }
    else { response.setHeader("Content-Type", "text/html"); response.end('<video id="live" muted autoplay playsinline></video><video id="history" muted autoplay playsinline></video>'); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const whep = `http://127.0.0.1:${rtcPort}/synthetic/whep`, hls = `http://127.0.0.1:${hlsPort}/synthetic/index.m3u8`;
  const connectPlayback = async () => {
    const result = await page.evaluate(async (url) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.addTransceiver("video", { direction: "recvonly" }); pc.addTransceiver("audio", { direction: "recvonly" });
      const video = document.querySelector("#live"); const stream = new MediaStream(); video.srcObject = stream;
      pc.ontrack = ({ track }) => stream.addTrack(track);
      await pc.setLocalDescription(await pc.createOffer());
      await Promise.race([new Promise((resolve) => { if (pc.iceGatheringState === "complete") resolve(); else pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") resolve(); }); }), new Promise((resolve) => setTimeout(resolve, 3000))]);
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription.sdp });
      if (response.status !== 201) throw new Error(`WHEP HTTP ${response.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
      window.testPeer = pc; await video.play();
      return new URL(response.headers.get("location"), url).href;
    }, whep);
    peers.add(result);
    await page.waitForFunction(() => { const video = document.querySelector("#live"); return video.videoWidth === 640 && video.currentTime > 1; }, { timeout: 30000 });
    return result;
  };
  await recordCase("真实 WHEP 浏览器解码 H264 与 Opus", async () => {
    await connectPlayback();
    const result = await page.evaluate(async () => {
      const stats = [...(await window.testPeer.getStats()).values()];
      const video = document.querySelector("#live"), canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
      canvas.getContext("2d").drawImage(video, 0, 0); const pixels = [...canvas.getContext("2d").getImageData(0, 0, 640, 360).data];
      const luminance = []; for (let index = 0; index < pixels.length; index += 256) luminance.push((pixels[index] + 2 * pixels[index + 1] + pixels[index + 2]) / 4);
      const incoming = (kind) => stats.find((entry) => entry.type === "inbound-rtp" && entry.kind === kind);
      const codec = (kind) => stats.find((entry) => entry.id === incoming(kind)?.codecId)?.mimeType;
      return { width: video.videoWidth, time: video.currentTime, changingPixels: Math.max(...luminance) - Math.min(...luminance),
        audioPackets: incoming("audio")?.packetsReceived || 0, audioCodec: codec("audio"), videoCodec: codec("video") };
    });
    assert.ok(result.changingPixels > 50 && result.audioPackets > 0);
    assert.match(result.audioCodec, /audio\/opus/i); assert.match(result.videoCodec, /video\/h264/i); return result;
  });
  await recordCase("真实 OBS WHIP 产物 HLS 回看与本地完整片存档", async () => {
    await eventually(async () => { const response = await fetch(hls); return response.ok && (await response.text()).includes("#EXTM3U"); }, "HLS 主清单", 40000);
    await page.evaluate(async (url) => { const { default: Hls } = await import("/hls.mjs"); const player = new Hls({ liveSyncDurationCount: 2 }); window.testHls = player; player.loadSource(url); player.attachMedia(document.querySelector("#history")); await document.querySelector("#history").play(); }, hls);
    await page.waitForFunction(() => { const video = document.querySelector("#history"); return video.videoWidth === 640 && video.currentTime > 1; }, { timeout: 30000 });
    const archived = path.join(output, "whip-history.mkv");
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", hls, "-t", "4", "-c", "copy", archived], 20000);
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-xerror", "-i", archived, "-f", "null", "-"]);
    const probe = JSON.parse(run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", archived]));
    assert.ok(probe.streams.some((stream) => stream.codec_name === "h264") && probe.streams.some((stream) => stream.codec_name === "opus"));
    return { hlsWidth: await page.locator("#history").evaluate((video) => video.videoWidth), archivedBytes: fs.statSync(archived).size, codecs: probe.streams.map((stream) => stream.codec_name) };
  });
  await recordCase("录像暂停恢复不停止 WHIP", async () => {
    await rpc.call("PauseRecord"); assert.equal((await rpc.call("GetRecordStatus")).outputPaused, true);
    const before = await rpc.call("GetStreamStatus"); await delay(2200);
    assert.ok((await rpc.call("GetStreamStatus")).outputBytes > before.outputBytes);
    await rpc.call("ResumeRecord"); assert.equal((await rpc.call("GetRecordStatus")).outputPaused, false);
    return { pauseMillis: 2200, streamingContinued: true };
  });
  await recordCase("媒体节点断流时本地录像继续、节点重建后 WHIP/WHEP 恢复", async () => {
    await stop(media); await delay(2500);
    const first = await rpc.call("GetRecordStatus"); assert.equal(first.outputActive, true);
    await delay(1500); assert.ok((await rpc.call("GetRecordStatus")).outputBytes > first.outputBytes);
    await rpc.call("StopStream").catch(() => {});
    await eventually(async () => !(await rpc.call("GetStreamStatus")).outputActive, "WHIP 停止");
    media = bootMedia(); await delay(500); await rpc.call("StartStream");
    await eventually(async () => { const status = await rpc.call("GetStreamStatus"); return status.outputActive && status.outputBytes > 10000; }, "WHIP 重建");
    await page.evaluate(() => { window.testPeer?.close(); window.testHls?.destroy(); });
    await connectPlayback(); return { recordingContinued: true, whepRebuilt: true };
  });
  await recordCase("OBS 正式持续录像手动分片与首片完整解码", async () => {
    const first = files(recordings).find((filename) => filename.endsWith(".mkv"));
    assert.ok(first, "尚未建立本地持续录像");
    await rpc.call("SplitRecordFile");
    await eventually(async () => files(recordings).filter((filename) => filename.endsWith(".mkv")).length >= 2, "OBS 手动分片");
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-xerror", "-i", first, "-f", "null", "-"], 60000);
    const firstProbe = JSON.parse(run(ffprobe, ["-v", "error", "-show_format", "-of", "json", first]));
    assert.equal((await rpc.call("GetRecordStatus")).outputActive, true);
    assert.equal((await rpc.call("GetStreamStatus")).outputActive, true);
    return { firstBytes: fs.statSync(first).size, firstSeconds: Number(firstProbe.format.duration), recordingContinued: true, streamingContinued: true };
  });
  await recordCase("停止直播保留持续录像、再次直播与最终完整解码", async () => {
    await rpc.call("StopStream"); await eventually(async () => !(await rpc.call("GetStreamStatus")).outputActive, "停止直播");
    assert.equal((await rpc.call("GetRecordStatus")).outputActive, true);
    await rpc.call("StartStream"); await eventually(async () => (await rpc.call("GetStreamStatus")).outputBytes > 10000, "再次直播");
    await delay(2500); await rpc.call("StopStream");
    const recorded = await rpc.call("StopRecord");
    const recordedPath = path.resolve(recorded.outputPath), relative = path.relative(recordings, recordedPath);
    assert.ok(relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative), "录制只能写独立测试目录");
    // OBS 在手动分片后可能仍返回首片路径；必须逐片验证，不能把尾片遗漏。
    const recordedFiles = files(recordings).filter((filename) => filename.endsWith(".mkv")).sort();
    assert.ok(recordedFiles.length >= 2, "未留下手动分片前后两份实际录像");
    const verified = recordedFiles.map((filename) => {
      run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-xerror", "-i", filename, "-f", "null", "-"], 60000);
      const probe = JSON.parse(run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", filename]));
      assert.ok(probe.streams.some((stream) => stream.codec_name === "h264") && probe.streams.some((stream) => stream.codec_name === "aac"));
      return { file: path.basename(filename), bytes: fs.statSync(filename).size, seconds: Number(probe.format.duration),
        codecs: probe.streams.map((stream) => stream.codec_name), sha256: createHash("sha256").update(fs.readFileSync(filename)).digest("hex") };
    });
    report.recordedFiles = verified; report.recordedDurationSeconds = verified.reduce((sum, file) => sum + file.seconds, 0);
    report.stopResponseFile = path.basename(recordedPath);
    return { files: verified, totalSeconds: report.recordedDurationSeconds };
  });
  assert.deepEqual(inventory(sourceObs), before, "原始 OBS 公共运行时被修改");
  report.originalRuntimeUnchanged = true;
  await page.screenshot({ path: path.join(output, "synthetic-obs-whep-hls.png") });
}

main().catch((error) => { report.errors.push(error.message); console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (rpc) {
    await rpc.call("StopStream").catch(() => {}); await rpc.call("StopRecord").catch(() => {}); rpc.close();
  }
  for (const url of peers) await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(1000) }).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const child of [...children].reverse()) await stop(child).catch((error) => report.errors.push(error.message));
  report.finishedAt = new Date().toISOString(); report.ownProcessesExited = children.every((child) => child.exitCode !== null || child.signalCode !== null);
  if (fs.existsSync(output)) fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
});
