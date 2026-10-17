const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** 只记录独立验收进程与当前元素范围，输入驱动还会核对EXE、窗口及遮挡。 */
exports.prepareWindowsDrag = async ({ page, source, target, output, nativePid, debugPort }) => {
  const ready = path.join(output, "native-drag-ready.json");
  fs.writeFileSync(ready, JSON.stringify({ nativePid, debugPort, source: await source.boundingBox(), target: await target.boundingBox(),
    sourceLabel: await source.getAttribute("aria-label"), targetLabel: await target.getAttribute("aria-label"),
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })) }));
  return ready;
};

/** 发送OS鼠标，调用方继续用实际DOM及Rust落盘确认，不能将inputSent当功能通过。 */
exports.dragWithWindowsMouse = async (request) => {
  const ready = await exports.prepareWindowsDrag(request);
  const python = path.resolve(__dirname, "../../../../backend/.venv/Scripts/python.exe");
  assert.ok(fs.existsSync(python), "缺少项目验证用Python环境");
  const activation = spawnSync(python, [path.join(__dirname, "drag.py"), "--ready", ready, "--activate"], { windowsHide: true, encoding: "utf8" });
  assert.equal(activation.status, 0, activation.stderr);
  await request.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await exports.prepareWindowsDrag(request);
  const sourceBefore = await request.source.evaluate((node) => ({ draggable: node.draggable, disabled: node.disabled,
    track: node.closest("[data-replay-track]")?.dataset.replayTrack, rect: node.getBoundingClientRect().toJSON() }));
  await request.page.evaluate(() => {
    window.__WINDOWS_DRAG_OBSERVED__ = [];
    for (const type of ["pointerdown", "dragstart", "dragover", "drop", "dragend"]) window.addEventListener(type, (event) => {
      window.__WINDOWS_DRAG_OBSERVED__.push({ type, x: event.clientX, y: event.clientY,
        label: event.target.closest?.("button")?.getAttribute("aria-label"), track: event.target.closest?.("[data-replay-track]")?.dataset.replayTrack,
        prevented: event.defaultPrevented, key: event.dataTransfer?.getData("application/x-wow-replay-track"), effect: event.dataTransfer?.dropEffect });
      if (window.__WINDOWS_DRAG_OBSERVED__.length > 100) window.__WINDOWS_DRAG_OBSERVED__.shift();
    });
  });
  const result = spawnSync(python, [path.join(__dirname, "drag.py"), "--ready", ready], { windowsHide: true, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { ...JSON.parse(fs.readFileSync(path.join(request.output, "windows-mouse-drag.json"), "utf8")), sourceBefore };
};
