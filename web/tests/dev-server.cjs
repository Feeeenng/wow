const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { TestCloudStack } = require("./real-stack.cjs");

const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output"));
const stack = new TestCloudStack({ python: path.resolve(argument("--python")), privateFile: path.resolve(argument("--private")), output: path.join(output, "services") });
let child; const report = {};
async function main() {
  fs.mkdirSync(output, { recursive: true });
  try {
    const info = await stack.start();
    const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
    child = spawn(process.execPath, [path.resolve(__dirname, "../node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)],
      { windowsHide: true, cwd: path.resolve(__dirname, ".."), env: { ...process.env, WOW_API_TARGET: info.endpoint }, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => fs.appendFileSync(path.join(output, "vite.log"), data));
    const root = "http://127.0.0.1:" + port, deadline = Date.now() + 20000;
    while (true) { try { if ((await fetch(root)).ok) break; } catch {} assert.equal(child.exitCode, null); assert.ok(Date.now() < deadline); await new Promise((resolve) => setTimeout(resolve, 100)); }
    report.index = (await fetch(root)).status; assert.equal(report.index, 200);
    const sharedPath = path.resolve(__dirname, "../../shared/replay/mapping.ts").split(path.sep).join("/");
    report.sharedMapping = (await fetch(root + "/@fs/" + sharedPath)).status; assert.equal(report.sharedMapping, 200);
    const editorPath = path.resolve(__dirname, "../../shared/annotations/editor/VideoAnnotations.tsx").split(path.sep).join("/");
    const editor = await fetch(root + "/@fs/" + editorPath); report.sharedEditor = editor.status;
    assert.equal(editor.status, 200); assert.ok((await editor.text()).includes("/node_modules/.vite/deps/react"));
    const notice = await fetch(root + "/game-data-NOTICE.txt"); report.notice = notice.status;
    assert.equal(await notice.text(), fs.readFileSync(path.resolve(__dirname, "../../client/src-tauri/resources/game-data/NOTICE.md"), "utf8"));
    report.anonymousMe = (await fetch(root + "/api/v1/me")).status; assert.equal(report.anonymousMe, 401);
    const profile = await fetch(root + "/api/v1/me", { headers: { Authorization: "Bearer " + info.token } });
    assert.equal((await profile.json()).userId, info.userId); report.authenticatedMe = profile.status; assert.equal(profile.status, 200);
    report.passed = true;
  } finally {
    if (child?.exitCode === null) {
      if (process.platform === "win32") execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill();
    }
    report.cleanup = await stack.close(); fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}
main().then(() => console.log("PASS Web开发入口、共享模块、许可和真实API代理")).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
