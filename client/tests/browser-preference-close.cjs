const assert = require("node:assert/strict");

/** 明确IPC夹具覆盖关闭保存失败；真实落盘和立即退出由原生脚本另行验证。 */
exports.verifyPreferenceClose = async ({ page }) => {
  await page.getByRole("button", { name: "设置时间轴外观", exact: true }).click();
  const height = page.getByRole("spinbutton", { name: "时间轴轨道高度", exact: true });
  await page.evaluate(() => { window.__REPLAY_TEST__.failSave = true; });
  await height.fill("45"); await height.press("Tab");
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
  await page.getByText("回放设置保存失败，已取消关闭。请处理错误后再次关闭。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__REPLAY_TEST__.closeCount), 0);
  assert.equal(await height.inputValue(), "45");
  await page.evaluate(() => { window.__REPLAY_TEST__.failSave = false; });
  await height.fill("46"); await height.press("Tab");
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }));
  assert.equal(await page.evaluate(() => window.__REPLAY_TEST__.closeCount), 1);
  assert.equal(await page.evaluate(() => window.__REPLAY_TEST__.closeSnapshot.timelineTrackHeight), 46);
};
