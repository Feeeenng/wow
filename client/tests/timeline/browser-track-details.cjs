const assert = require("node:assert/strict");
const { selectWithKeyboard } = require("./keyboard-select.cjs");

/** 实际React／媒体，IPC为显式夹具；验证后续页键盘移轨及混合规则保护。 */
exports.verifyTrackDetails = async ({ page, refresh, expectTime }) => {
  const original = await page.evaluate(() => structuredClone(window.__REPLAY_TEST__.fixture.timelineEvents));
  const close = async () => {
    await page.locator(".replay-header-title").click();
    await page.waitForFunction(() => ![...document.querySelectorAll('[aria-label="时间轴分组事件详情"]')].some((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"));
  };
  const popup = () => page.locator('[aria-label="时间轴分组事件详情"]:visible');
  const owner = () => page.locator('[data-replay-track="player"]');
  const video = () => page.locator("video[aria-label$='本地回放']");
  const name = "键盘明细轨道";
  let id;
  try {
    await page.evaluate(() => {
      window.__REPLAY_TEST__.fixture.timelineEvents = Array.from({ length: 75 }, (_, index) => ({
        eventId: "detail-" + index, pullTimeMs: 5000 + index, owner: "player", kind: "castSuccess",
        sourceGuid: index < 45 ? "Player-DetailA" : "Player-DetailB", sourceName: "同名角色", targetGuid: "Player-1", targetName: "目标",
        spellId: 17, spellName: "细分测试", extraSpellId: null, stackCount: null,
      }));
      window.__REPLAY_TEST__.fixture.timelineEvents.push({ ...window.__REPLAY_TEST__.fixture.timelineEvents[0], eventId: "detail-unknown", pullTimeMs: 9000, sourceGuid: "", spellName: "未知来源测试" });
    });
    await refresh(); await owner().getByRole("button", { name: /细分测试.*等 75 个事件/ }).waitFor();
    const before = await page.evaluate(() => JSON.stringify(window.__REPLAY_TEST__.fixture.timelineEvents));
    const unknown = owner().getByRole("button", { name: /^未知来源测试/ });
    assert.equal(await unknown.getAttribute("draggable"), "false"); await unknown.click();
    assert.equal(await popup().locator('[data-event-id="detail-unknown"]').getByRole("combobox").isDisabled(), true); await close(); await expectTime(6);
    await video().evaluate((element) => { element.pause(); element.dataset.detailInstance = "same"; });
    const time = await video().evaluate((element) => element.currentTime);
    assert.equal(await owner().getByRole("button", { name: /等 75 个事件/ }).getAttribute("draggable"), "false");
    await page.getByRole("button", { name: "轨道布局", exact: true }).click();
    await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill(name);
    await page.getByRole("button", { name: "新增个人轨道", exact: true }).click(); await close();
    id = await page.getByRole("slider", { name: "跳转到" + name + "时间", exact: true }).locator("..").getAttribute("data-replay-track");
    assert.match(id, /^custom-[a-f0-9-]{36}$/);
    await owner().getByRole("button", { name: /等 75 个事件/ }).click();
    await popup().locator('[data-event-id]').first().waitFor();
    assert.equal(await popup().locator('[data-event-id]').count(), 20);
    await popup().getByRole("button", { name: "下一页分组事件", exact: true }).click();
    await popup().getByRole("button", { name: "下一页分组事件", exact: true }).click();
    await popup().locator('[data-event-id="detail-45"]').waitFor();
    const picker = popup().locator('[data-event-id="detail-45"]').getByRole("combobox");
    await selectWithKeyboard(page, picker, name); await close();
    const custom = page.locator('[data-replay-track="' + id + '"]');
    await custom.getByRole("button", { name: /等 30 个事件/ }).waitFor();
    assert.equal(await custom.locator('button[draggable="true"]').count(), 1);
    assert.equal(await owner().getByRole("button", { name: /等 45 个事件/ }).getAttribute("draggable"), "true");
    await page.waitForFunction((target) => window.__REPLAY_TEST__.preferences.timelineTrackOverrides["player:17:castSuccess:Player-DetailB"] === target, id);
    assert.equal(await page.evaluate(() => window.__REPLAY_TEST__.preferences.timelineTrackOverrides["player:17:castSuccess:Player-DetailA"]), undefined);
    assert.equal(await video().evaluate((element) => element.dataset.detailInstance), "same");
    assert.ok(Math.abs(await video().evaluate((element) => element.currentTime) - time) < .06);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__REPLAY_TEST__.fixture.timelineEvents)), before);
    await custom.getByRole("button", { name: /等 30 个事件/ }).dragTo(page.getByRole("slider", { name: "跳转到团队技能时间", exact: true }));
    const team = page.locator('[data-replay-track="team"]'); await team.getByRole("button", { name: /等 30 个事件/ }).waitFor();
    await page.waitForFunction(() => window.__REPLAY_TEST__.preferences.timelineTrackOverrides["player:17:castSuccess:Player-DetailB"] === "team");
    await team.getByRole("button", { name: /等 30 个事件/ }).click();
    const back = popup().locator('[data-event-id="detail-45"]').getByRole("combobox");
    await selectWithKeyboard(page, back, "个人技能"); await close();
    await owner().getByRole("button", { name: /等 75 个事件/ }).waitFor();
    await page.waitForFunction(() => !("player:17:castSuccess:Player-DetailB" in window.__REPLAY_TEST__.preferences.timelineTrackOverrides));
    await owner().getByRole("button", { name: /等 75 个事件/ }).click();
    const previous = popup().getByRole("button", { name: "上一页分组事件", exact: true });
    while (!await previous.isDisabled()) await previous.click();
    await popup().getByRole("button", { name: "下一页分组事件", exact: true }).click();
    await popup().getByRole("button", { name: "下一页分组事件", exact: true }).click();
    await popup().locator('[data-event-id="detail-40"]').locator("button").click(); await expectTime(2.04); await close();
    assert.equal(await page.evaluate(() => JSON.stringify(window.__REPLAY_TEST__.fixture.timelineEvents)), before);
  } finally {
    await close();
    if (id) {
      await page.getByRole("button", { name: "轨道布局", exact: true }).click();
      await page.getByRole("button", { name: "删除" + name + "轨道", exact: true }).click(); await close();
    }
    await page.evaluate((events) => { window.__REPLAY_TEST__.fixture.timelineEvents = events; }, original); await refresh();
  }
};
