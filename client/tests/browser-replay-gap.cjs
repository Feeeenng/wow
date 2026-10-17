const assert = require("node:assert/strict");

/** 真实浏览器验证微调跨段拒绝及反向游标保护，索引IPC仅提供合成声明。 */
exports.verifyGapOffsetBounds = async ({ page, fixture, refresh, seek, expectTime }) => {
  const zero = fixture.mapping.videoZeroMs;
  await page.evaluate(({ zero }) => {
    const mapping = window.__REPLAY_TEST__.fixture.mapping;
    mapping.hasGap = true; mapping.mediaCalibrated = true;
    mapping.intervals = [
      { pullStartMs: 0, pullEndMs: 4000, videoStartMs: zero, videoEndMs: zero + 4000 },
      { pullStartMs: 6000, pullEndMs: 10000, videoStartMs: zero + 4000, videoEndMs: zero + 8000 },
    ];
  }, { zero });
  await refresh(); await seek(3); await expectTime(3);
  await page.getByRole("button", { name: "对齐微调", exact: true }).click();
  const input = page.getByRole("spinbutton", { name: "本机对齐偏移", exact: true });
  await input.fill("500"); await input.press("Tab");
  await page.waitForFunction((target) => { const video = document.querySelector("video[aria-label$='本地回放']"); return video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target) < 0.06; }, (zero + 3500) / 1000);
  await page.getByText("战斗时间轴", { exact: true }).click();
  const before = await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime);
  await seek(3.8); await page.getByText("该战斗时段没有录像，请选择其他时间。", { exact: true }).waitFor();
  assert.ok(Math.abs(await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime) - before) < 0.06);
  await page.locator("video[aria-label$='本地回放']").evaluate((video, target) => { video.currentTime = target; }, (zero + 4300) / 1000);
  await page.waitForFunction(() => !document.querySelector("video[aria-label$='本地回放']").seeking);
  assert.ok(Math.abs(Number(await page.getByRole("slider", { name: "跳转到敌方技能时间", exact: true }).getAttribute("aria-valuenow")) - 3) < 0.1);
  await page.getByRole("button", { name: "对齐微调", exact: true }).click();
  await input.fill("0"); await input.press("Tab"); await page.getByText("战斗时间轴", { exact: true }).click(); await expectTime(3);
  await page.evaluate((mapping) => { window.__REPLAY_TEST__.fixture.mapping = mapping; }, fixture.mapping);
  await refresh();
};
