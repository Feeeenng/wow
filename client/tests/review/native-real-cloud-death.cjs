const assert = require("node:assert/strict");
const path = require("node:path");

/** 通过实际Rust／FastAPI／PG／Redis读取窗口；仅WCL上游为明确协议服务。 */
exports.verifyRealCloudDeath = async ({ page, invoke, run, requestBridge, a, b, output, report }) => {
  const get = (pullId, eventId, cursor = null, refresh = false) => invoke("get_cloud_death_review", { pullId, eventId, cursor, limit: 250, refresh });
  const timeline = await invoke("list_cloud_replay_events", { pullId: a.pullId, cursor: null, limit: 100 });
  const death = timeline.events.find((event) => event.kind === "death" && event.targetActorId === 1);
  assert.ok(death);
  let first;
  await run("死亡窗口经实际Rust与FastAPI读取263条，Redis命中且游标签名限定视角", async () => {
    first = await get(a.pullId, death.eventId);
    assert.equal(first.availability, "ready"); assert.equal(first.sourceKind, "wcl");
    assert.equal(first.events.length, 250); assert.equal(first.total, 263); assert.equal(first.hasMore, true);
    const before = await requestBridge("inspect");
    assert.equal(before.wcl.resourceQueries, 2, "窗口两页必须显式请求资源");
    assert.equal(before.deathCache.count, 1); assert.ok(before.deathCache.ttls.every((ttl) => ttl > 0 && ttl <= 120));
    const following = await get(a.pullId, death.eventId, first.nextCursor);
    assert.equal(following.revision, first.revision); assert.equal(following.events.length, 13); assert.equal(following.hasMore, false);
    const rows = [...first.events, ...following.events];
    assert.equal(rows.at(-1).eventId, death.eventId);
    assert.deepEqual(new Set(first.victimRecordingIds), new Set([a.pullId]));
    assert.deepEqual(new Set(first.relatedRecordingIds), new Set([b.pullId]));
    assert.equal(rows.find((row) => row.kind === "heal").amount, 0);
    assert.equal(rows.find((row) => row.health !== null).health, 80);
    const sum = (kind) => rows.filter((row) => row.kind === kind).reduce((total, row) => total + row.amount, 0);
    assert.equal(sum("heal"), 6630); assert.equal(sum("damage"), 27040);
    const after = await requestBridge("inspect"); assert.equal(after.wcl.requests, before.wcl.requests);
    for (const [pullId, cursor] of [[b.pullId, first.nextCursor], [a.pullId, first.nextCursor + "bad"]]) {
      let rejected = false; try { await get(pullId, death.eventId, cursor); } catch { rejected = true; }
      assert.equal(rejected, true);
    }
    report.teamDeath = { rows: rows.length, pageSizes: [250, 13], damageRecordAmount: 27040, healingRecordAmount: 6630, cacheHit: true, signedScopeVerified: true };
  });
  await run("实际团队死亡界面分页及关联定位保留播放参数，重读不重建当前媒体", async () => {
    await page.getByRole("button", { name: `观看${a.playerName}视角`, exact: true }).click();
    const video = page.locator("video[aria-label$='团队回放']");
    await page.waitForFunction(() => document.querySelector("video[aria-label$='团队回放']")?.readyState >= 2);
    await video.evaluate((element) => { element.pause(); element.volume = .35; element.muted = true; element.playbackRate = 1.25; element.dataset.realDeathInstance = "same"; });
    await page.getByRole("button", { name: "死亡明细", exact: true }).click();
    const drawer = page.locator(".death-review-drawer");
    await drawer.getByText("来源：WCL公开报告快照", { exact: false }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.death-review-body [role="status"]'));
    assert.equal(await video.evaluate((element) => element.dataset.realDeathInstance), "same");
    assert.equal(await drawer.locator("[data-review-event]").count(), 25);
    const detail = drawer.getByRole("region", { name: "死亡窗口事件明细", exact: true });
    await detail.locator(".ant-pagination-next").click();
    assert.equal(await detail.locator("[data-review-event]").first().getAttribute("data-review-event"), first.events[25].eventId);
    await drawer.getByRole("button", { name: `相关 · ${b.playerName}视角`, exact: true }).click();
    await page.waitForFunction((expected) => { const video = document.querySelector("video[aria-label$='团队回放']"); return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - expected) < .15; }, b.mapping.videoZeroMs / 1000);
    assert.equal(await video.count(), 1);
    assert.deepEqual(await video.evaluate((element) => ({ paused: element.paused, rate: element.playbackRate, volume: element.volume, muted: element.muted })), { paused: true, rate: 1.25, volume: .35, muted: true });
    await video.evaluate((element) => { element.dataset.realDeathInstance = "related"; });
    await drawer.getByRole("button", { name: "重新读取死亡明细", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.death-review-body [role="status"]'));
    await drawer.getByText("来源：WCL公开报告快照", { exact: false }).waitFor();
    assert.equal(await video.evaluate((element) => element.dataset.realDeathInstance), "related");
    await page.screenshot({ path: path.join(output, "native-real-cloud-death.png"), fullPage: true });
    await drawer.locator(".ant-drawer-close").click();
    await page.waitForFunction(() => !document.querySelector(".death-review-drawer.ant-drawer-open"));
    report.teamDeath.realInterfaceVerified = true;
  });
  return { pullId: a.pullId, eventId: death.eventId, cursor: first.nextCursor };
};
