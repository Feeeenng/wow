const assert = require("node:assert/strict");
const { waitUntil } = require("../wait-until.cjs");
const { prepareWindowsDrag, dragWithWindowsMouse } = require("./windows/interaction.cjs");

/** 记录真实鼠标拖放事件，不用dispatchEvent替代Windows原生事件链。 */
exports.verifyNativeCloudDrag = async ({ page, invoke, run, report, manual, windowsMouse, output, nativePid, debugPort }) => {
  await run("Windows原生窗口实际HTML5拖轨产生drop并保存显示规则", async () => {
    await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
    await page.getByRole("button", { name: "观看视角甲视角", exact: true }).click();
    const source = page.getByRole("button", { name: "标准技能 蓄力开始 0:02", exact: true });
    await source.waitFor();
    assert.equal(await source.getAttribute("draggable"), "true");
    await page.getByRole("button", { name: "轨道布局", exact: true }).click();
    await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill("原生鼠标拖轨");
    await page.getByRole("button", { name: "新增个人轨道", exact: true }).click();
    await page.locator(".replay-header-title").click();
    const target = page.getByRole("slider", { name: "跳转到原生鼠标拖轨时间", exact: true });
    const trackId = await target.locator("..").getAttribute("data-replay-track");
    const video = page.locator("video[aria-label$='团队回放']");
    await video.evaluate((element) => element.pause());
    const mediaBefore = await video.evaluate((element) => ({ time: element.currentTime, rate: element.playbackRate, volume: element.volume, muted: element.muted }));
    await page.evaluate(() => {
      window.__NATIVE_DRAG_TRACE__ = [];
      for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dragstart", "dragover", "drop", "dragend"]) window.addEventListener(type, (event) => {
        window.__NATIVE_DRAG_TRACE__.push({ type, track: event.target.closest?.("[data-replay-track]")?.dataset.replayTrack,
          x: event.clientX, y: event.clientY, label: event.target.closest?.("button")?.getAttribute("aria-label"),
          types: [...(event.dataTransfer?.types ?? [])], effect: event.dataTransfer?.dropEffect });
        if (window.__NATIVE_DRAG_TRACE__.length > 100) window.__NATIVE_DRAG_TRACE__.shift();
      });
    });
    try {
      if (manual || windowsMouse) {
        if (windowsMouse) report.windowsMouse = await dragWithWindowsMouse({ page, source, target, output, nativePid, debugPort });
        else await prepareWindowsDrag({ page, source, target, output, nativePid, debugPort });
        console.log("等待独立窗口真实鼠标拖轨");
        await waitUntil(() => invoke("get_replay_preferences"), (value) => Object.values(value.timelineTrackOverrides).includes(trackId), "真实鼠标移入个人轨道", 120000);
      } else await source.dragTo(target);
    } finally { report.dragTrace = await page.evaluate(() => window.__NATIVE_DRAG_TRACE__); }
    assert.ok(report.dragTrace.some((event) => event.type === "drop"), "真实Windows拖放没有到达网页drop");
    await page.locator('[data-replay-track="' + trackId + '"]').getByRole("button", { name: "标准技能 蓄力开始 0:02", exact: true }).waitFor();
    const mediaAfter = await video.evaluate((element) => ({ time: element.currentTime, rate: element.playbackRate, volume: element.volume, muted: element.muted }));
    assert.ok(Math.abs(mediaAfter.time - mediaBefore.time) < .1);
    assert.deepEqual({ ...mediaAfter, time: 0 }, { ...mediaBefore, time: 0 });
    await page.locator(".replay-header-title").click();
    await page.getByRole("navigation").getByRole("button", { name: "个人中心" }).click();
  });
};
