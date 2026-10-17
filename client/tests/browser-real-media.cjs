const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

// 只读复用隔离验收的真实HLS，普通Edge与原生协议分别验收，不重编码原片。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const indexPath = path.resolve(argument("--index"));
const output = path.resolve(argument("--output"));
const playwright = require(path.resolve(argument("--playwright")));
assert.ok(indexPath.includes("com.wow.recorder.validation20261017"));
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const pulls = index.pulls.filter((item) => item.importedSource && item.state === "ready" && item.timelineEvents.length > 100);
assert.equal(pulls.length, 3);
const report = { cases: [], boundary: "已存在的三场实战HLS只读HTTP播放；普通Edge／hls.js，不替代原生协议和游戏采集验收" };
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<video muted controls style="width:960px"></video>'); return; }
  const match = pathname.match(/^\/hls\/(\d)\/(index\.m3u8|init\.mp4|segment-\d{5}\.m4s)$/);
  if (!match || !pulls[Number(match[1])]) { response.writeHead(404).end(); return; }
  const file = path.join(path.dirname(pulls[Number(match[1])].playbackPath), match[2]);
  if (!fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", file.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4");
  response.setHeader("Content-Length", fs.statSync(file).size);
  fs.createReadStream(file).pipe(response);
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    for (const [number, pull] of pulls.entries()) {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(origin);
      await page.addScriptTag({ path: path.resolve(__dirname, "../node_modules/hls.js/dist/hls.js") });
      await page.evaluate((url) => {
        const video = document.querySelector("video"); video.muted = true;
        const hls = new Hls(); window.__MEDIA_TEST__ = { errors: [], codecs: [], fragments: [] };
        const result = window.__MEDIA_TEST__;
        hls.on(Hls.Events.ERROR, (_, data) => result.errors.push({ type: data.type, details: data.details, fatal: data.fatal, message: data.error?.message }));
        hls.on(Hls.Events.BUFFER_CODECS, (_, data) => result.codecs.push(Object.fromEntries(Object.entries(data.tracks).map(([key, value]) => [key, { codec: value.codec, container: value.container }]))));
        hls.on(Hls.Events.FRAG_LOADED, (_, data) => result.fragments.push(data.frag.sn));
        hls.loadSource(url); hls.attachMedia(video);
      }, `${origin}/hls/${number}/index.m3u8`);
      await page.waitForFunction(() => document.querySelector("video").error || document.querySelector("video").readyState >= 2, null, { timeout: 20000 }).catch(() => {});
      let state = await page.evaluate(() => {
        const video = document.querySelector("video");
        return { ...window.__MEDIA_TEST__, readyState: video.readyState, duration: video.duration, mediaError: video.error?.message };
      });
      if (!state.mediaError && state.readyState >= 2) {
        await page.evaluate((seconds) => { const video = document.querySelector("video"); video.currentTime = seconds; }, 5 + pull.mapping.videoZeroMs / 1000);
        await page.waitForFunction((seconds) => { const video = document.querySelector("video"); return video.error || (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - seconds) < 0.2); }, 5 + pull.mapping.videoZeroMs / 1000, { timeout: 15000 });
        state = await page.evaluate(() => { const video = document.querySelector("video"); return { ...window.__MEDIA_TEST__, readyState: video.readyState, currentTime: video.currentTime, decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames, mediaError: video.error?.message }; });
      }
      report.cases.push({ number, ...state, pageErrors, passed: !state.mediaError && state.readyState >= 2 && state.decodedFrames > 0 && pageErrors.length === 0 });
      console.log(JSON.stringify(report.cases.at(-1)));
      await page.close();
    }
    report.passed = report.cases.every((item) => item.passed);
    assert.equal(report.passed, true, "真实HLS中存在浏览器不可播放产物");
  } finally {
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
