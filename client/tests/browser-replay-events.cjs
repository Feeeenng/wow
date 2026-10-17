const assert = require("node:assert/strict");

/** 复用实际工作台与媒体，验证新增事件的筛选、等级显示和定位。 */
exports.verifyExtendedEvents = async ({ page, refresh, expectTime, fixture }) => {
  const kinds = [["buffRefresh", "增益刷新"], ["debuffRefresh", "减益刷新"], ["empowerStart", "蓄力开始"], ["empowerEnd", "蓄力释放"], ["empowerInterrupt", "蓄力中断"], ["resurrect", "复活"]];
  await page.evaluate((kinds) => {
    window.__REPLAY_TEST__.fixture.timelineEvents = kinds.map(([kind], index) => ({
      eventId: `extended-${kind}`, pullTimeMs: (index + 1) * 1000, owner: "player", kind,
      sourceName: "测试角色", sourceGuid: "Player-1", targetName: "测试队友", targetGuid: "Player-2",
      spellId: 17, spellName: "延续测试", extraSpellId: null, stackCount: null,
      empowerLevel: kind === "empowerEnd" ? 3 : kind === "empowerInterrupt" ? 0 : null,
    }));
  }, kinds);
  await refresh();
  const select = page.locator(".ant-select").filter({ has: page.locator('[aria-label="筛选事件类型"]') });
  for (const [index, [kind, label]] of kinds.entries()) {
    await page.locator('[aria-label="筛选事件类型"]').click();
    await page.locator('[aria-label="筛选事件类型"]').fill(label);
    await page.getByText(label, { exact: true }).last().click();
    await page.keyboard.press("Escape");
    await page.getByText("战斗时间轴", { exact: true }).click();
    const marker = page.getByRole("button", { name: new RegExp(`^延续测试 ${label} `) });
    await marker.waitFor();
    assert.equal(await page.locator(".replay-timeline-track button[draggable='true']").count(), 1);
    await marker.click();
    await expectTime(Math.max(0, index + 1 - 3));
    if (kind === "empowerEnd" || kind === "empowerInterrupt") await page.getByText(new RegExp(`蓄力等级 ${kind === "empowerEnd" ? 3 : 0}`)).waitFor();
    await page.getByText("战斗时间轴", { exact: true }).click();
    await select.hover(); await select.locator(".ant-select-clear").click();
  }
  await page.evaluate((events) => { window.__REPLAY_TEST__.fixture.timelineEvents = events; }, fixture.timelineEvents);
  await refresh();
  await page.locator("img[alt='圣盾术']").waitFor();
};
