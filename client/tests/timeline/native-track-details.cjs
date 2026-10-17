const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { loadSource } = require("../source-loader.cjs");
const { selectWithKeyboard } = require("./keyboard-select.cjs");
const { waitUntil } = require("../wait-until.cjs");
const { canAssignTimelineTrack, trackOverrideKey, eventTrack, timelineTracks } = loadSource("../shared/replay/tracks.ts");
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** 独立原生窗口验证真实分组、键盘入口、Rust落盘和重启；不替换任何IPC响应。 */
exports.verifyNativeTrackDetails = async ({ page, invoke, restart, events, pullId, output }) => {
  const report = { cases: [], boundary: "真实Tauri／Rust LocalStateStore／实战索引及原片HLS；布局只改个人显示规则" };
  const run = async (name, check) => { await check(); report.cases.push({ name, passed: true }); console.log("PASS " + name); };
  const close = async () => {
    await page.locator(".replay-header-title").click();
    await page.waitForFunction(() => ![...document.querySelectorAll('[aria-label="时间轴分组事件详情"]')].some((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"));
  };
  const popup = () => page.locator('[aria-label="时间轴分组事件详情"]:visible');
  const video = () => page.locator("video[aria-label$='本地回放']");
  const name = "原生明细轨道"; let customId, selected, key;
  const before = digest(events);
  await run("真实混合规则分组禁拖且详情每页有界", async () => {
    const candidates = page.locator('[data-replay-track] button[draggable="false"]').filter({ hasText: /^\d+$/ });
    assert.ok(await candidates.count());
    let found = false;
    for (let index = 0; index < await candidates.count(); index++) {
      const marker = candidates.nth(index); if (await marker.isDisabled() || Number(await marker.innerText()) <= 20) continue;
      await marker.click(); const firstId = await popup().locator('[data-event-id]').first().getAttribute("data-event-id");
      const first = events.find((event) => event.eventId === firstId);
      if (!first?.spellId) { await close(); continue; }
      const keys = new Set(), visited = new Set(); let pageIndex = 0;
      while (true) {
        const ids = await popup().locator('[data-event-id]').evaluateAll((rows) => rows.map((row) => row.dataset.eventId));
        assert.ok(ids.length <= 20);
        assert.ok(!visited.has(ids[0]), "分组分页必须推进"); visited.add(ids[0]);
        for (const id of ids) keys.add(trackOverrideKey(events.find((event) => event.eventId === id)));
        const candidate = ids.map((id) => events.find((event) => event.eventId === id)).find(canAssignTimelineTrack);
        if (pageIndex > 0 && keys.size > 1 && candidate) { selected = candidate; report.selectedGroupPage = pageIndex + 1; report.groupCount = Number(await marker.innerText()); found = true; break; }
        const next = popup().getByRole("button", { name: "下一页分组事件", exact: true });
        if (!await next.count() || await next.isDisabled()) break;
        await next.click(); await page.waitForFunction((old) => document.querySelector('.ant-popover:not(.ant-popover-hidden) [aria-label="时间轴分组事件详情"] [data-event-id]')?.getAttribute("data-event-id") !== old, ids[0]);
        pageIndex++;
      }
      if (found) await page.screenshot({ path: path.join(output, "track-details-native-1440.png"), fullPage: true, animations: "disabled" });
      await close(); if (found) break;
    }
    assert.equal(found, true); key = trackOverrideKey(selected);
    report.rule = key;
    await page.setViewportSize({ width: 1080, height: 720 });
    await page.locator('[data-replay-track] button[draggable="false"]').filter({ has: page.locator("img"), hasText: /^\d+$/ }).first().click();
    await popup().getByRole("combobox").first().waitFor();
    const box = await popup().boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 1080);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, "track-details-native-1080.png"), fullPage: true, animations: "disabled" });
    await close(); await page.setViewportSize({ width: 1440, height: 900 });
  });
  await run("事件详情键盘移轨写入Rust，原媒体位置和实例保持", async () => {
    await video().evaluate((element) => { element.pause(); element.dataset.trackDetailsInstance = "same"; });
    const time = await video().evaluate((element) => element.currentTime);
    await page.getByRole("button", { name: "轨道布局", exact: true }).click();
    await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill(name);
    await page.getByRole("button", { name: "新增个人轨道", exact: true }).click(); await close();
    customId = await page.getByRole("slider", { name: "跳转到" + name + "时间", exact: true }).locator("..").getAttribute("data-replay-track");
    // 原分组仍可通过事件身份找到；分页依次查找而非假定第一项就是目标。
    const markers = page.locator('[data-replay-track] button[draggable="false"]').filter({ hasText: /^\d+$/ });
    let moved = false;
    for (let index = 0; index < await markers.count(); index++) {
      await markers.nth(index).click();
      await popup().locator('[data-event-id]').first().waitFor();
      while (true) {
        const picker = popup().locator('[data-event-id="' + selected.eventId + '"]').getByRole("combobox");
        if (await picker.count()) {
          await selectWithKeyboard(page, picker, name); moved = true; break;
        }
        const next = popup().getByRole("button", { name: "下一页分组事件", exact: true });
        if (!await next.count() || await next.isDisabled()) break;
        const old = await popup().locator('[data-event-id]').first().getAttribute("data-event-id"); await next.click();
        await page.waitForFunction((previous) => document.querySelector('.ant-popover:not(.ant-popover-hidden) [aria-label="时间轴分组事件详情"] [data-event-id]')?.getAttribute("data-event-id") !== previous, old);
      }
      await close(); if (moved) break;
    }
    assert.equal(moved, true);
    await waitUntil(() => invoke("get_replay_preferences"), (value) => value.timelineTrackOverrides[key] === customId, "个人轨道规则实际落盘");
    assert.equal(await video().evaluate((element) => element.dataset.trackDetailsInstance), "same");
    assert.ok(Math.abs(await video().evaluate((element) => element.currentTime) - time) < .1);
  });
  await run("客户端重启从LocalStateStore恢复详情移轨规则", async () => {
    page = await restart();
    assert.equal((await invoke("get_replay_preferences")).timelineTrackOverrides[key], customId, "重启后的Rust快照必须保留已落盘覆盖");
    await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
    await page.waitForFunction(() => document.querySelector("video[aria-label$='本地回放']")?.readyState >= 2);
    await page.locator('[data-replay-track="' + customId + '"] button[draggable="true"]').first().waitFor();
    const preferences = await invoke("get_replay_preferences"); assert.equal(preferences.timelineTrackOverrides[key], customId);
    assert.ok(preferences.customTimelineTracks.some((track) => track.id === customId && track.name === name));
  });
  await run("键盘返回固有轨道移除覆盖，原始事件完整不变", async () => {
    const custom = page.locator('[data-replay-track="' + customId + '"]'); await custom.locator('button[draggable="true"]').first().click();
    const id = await popup().locator('[data-event-id]').first().getAttribute("data-event-id");
    const event = events.find((item) => item.eventId === id); assert.equal(trackOverrideKey(event), key);
    const target = timelineTracks.findIndex((track) => track.id === eventTrack(event, {})); assert.ok(target >= 0);
    const picker = popup().locator('[data-event-id="' + id + '"]').getByRole("combobox");
    await selectWithKeyboard(page, picker, timelineTracks[target].label); await close();
    await waitUntil(() => invoke("get_replay_preferences"), (value) => !Object.hasOwn(value.timelineTrackOverrides, key), "删除覆盖实际落盘");
    const after = []; let cursor = null;
    do {
      const response = await invoke("list_replay_events", { pullId, cursor, limit: 1000 }); after.push(...response.events); cursor = response.hasMore ? response.nextCursor : null;
    } while (cursor);
    assert.equal(digest(after), before);
    await page.getByRole("button", { name: "轨道布局", exact: true }).click();
    await page.getByRole("button", { name: "删除" + name + "轨道", exact: true }).click(); await close();
  });
  await run("修改后立即离页并关闭，在防抖结束前退出仍恢复最新设置", async () => {
    await page.getByRole("button", { name: "设置时间轴外观", exact: true }).click();
    const height = page.getByRole("spinbutton", { name: "时间轴轨道高度", exact: true });
    await height.fill("31"); await height.press("Tab");
    await page.getByRole("navigation").getByRole("button", { name: /首页/ }).click();
    page = await restart(31);
    const saved = await invoke("get_replay_preferences");
    assert.equal(saved.timelineTrackHeight, 31); assert.equal(saved.customTimelineTracks.some((track) => track.id === customId), false);
    await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-replay-track]')?.getBoundingClientRect().height === 31);
  });
  report.passed = true; return report;
};
