const assert = require("node:assert/strict");
const path = require("node:path");
const { waitUntil } = require("../wait-until.cjs");

/** 明确HTTP夹具，只验证原生IPC与界面；真正API／PG权限由后端联调覆盖。 */
exports.createCloudDeathFixture = ({ ids }) => {
  const base = { eventId: "cloud-death", pullTimeMs: 6000, kind: "death", sourceGuid: "", sourceName: "未知来源", targetGuid: "", targetName: "同名玩家",
    sourceActorId: -1, targetActorId: 1, sourceIsPlayer: false, targetIsPlayer: true, identityNamespace: "wcl:AbCdEfGh12345678",
    spellId: 0, spellName: "", rawType: "death", amount: null, absorbed: null, overkill: null, overheal: null, health: null, maxHealth: null,
    stackCount: null, extraSpellId: null, empowerLevel: null, relatedSourceGuid: null, relatedSourceName: null };
  const rows = Array.from({ length: 259 }, (_, index) => ({ ...base, eventId: "review-" + index, kind: index % 5 === 0 ? "heal" : "damage", rawType: index % 5 === 0 ? "heal" : "damage",
    sourceActorId: index % 5 === 0 ? 2 : 10, sourceIsPlayer: index % 5 === 0, sourceName: "明确来源", pullTimeMs: 1000 + index * 10,
    spellId: 17, spellName: "协议数值技能", amount: index, health: index === 0 ? 80 : null, maxHealth: index === 0 ? 100 : null }));
  rows.push(base);
  let held;
  const state = { mode: "ready", calls: 0, refreshes: 0, held: false, death: { ...base, owner: "team" } };
  state.respond = (url, response) => {
    if (!url.pathname.endsWith("/death-review")) return false;
    state.calls++;
    if (url.searchParams.get("refresh") === "true") state.refreshes++;
    const offset = Number(url.searchParams.get("cursor") || 0), limit = Number(url.searchParams.get("limit"));
    if (url.searchParams.get("event_id") !== base.eventId || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 250) { response.writeHead(422).end(); return true; }
    const ready = state.mode === "ready" || state.mode === "hold", end = offset + limit;
    const document = { revision: ready ? "c".repeat(64) : "", sourceKind: "wcl", availability: ready ? "ready" : state.mode,
      message: ready ? null : "协议测试：WCL来源暂不可用，请重新读取。", death: base, windowStartMs: 0, windowEndMs: 6000,
      events: ready ? rows.slice(offset, end) : [], priorAuras: ready && offset === 0 ? [1, 2].map((actor) => ({ ...base, eventId: "prior-" + actor, kind: "buffApply", rawType: "applybuff", spellId: 17, spellName: "同技能光环", pullTimeMs: -actor,
        sourceActorId: actor, sourceIsPlayer: true, sourceName: "先前来源" + actor })) : [], total: ready ? rows.length : 0, observedCount: ready ? rows.length : 0,
      truncated: false, priorAurasTruncated: false, parseErrors: 0, pairedRowsRemoved: 0, victimRecordingIds: [ids[0]], relatedRecordingIds: [ids[1]],
      nextCursor: ready && end < rows.length ? String(end) : null, hasMore: ready && end < rows.length };
    const send = () => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(document)); state.held = false; };
    if (state.mode === "hold") { held = send; state.held = true; } else send();
    return true;
  };
  state.release = () => { if (held) { held(); held = null; } };
  return state;
};

/** 真实Tauri窗口验证WCL死亡分页、关联定位、异常恢复及换凭证迟到响应隔离。 */
exports.verifyCloudDeath = async ({ page, invoke, run, fixture, origin, team, ids, tokens, output }) => {
  await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
  const drawer = page.locator(".death-review-drawer");
  const open = async () => { await page.getByRole("button", { name: "观看视角甲视角", exact: true }).click(); await page.getByRole("button", { name: "死亡复盘", exact: true }).click(); };
  const ready = async () => { await drawer.getByText("来源：WCL公开报告快照", { exact: false }).waitFor(); await page.waitForFunction(() => !document.querySelector('.death-review-body [role="status"]')); };
  await run("原生团队死亡通过Rust读取260条WCL快照，GUID为空仍可进入并分页", async () => {
    await open(); await ready();
    assert.equal(await drawer.locator("[data-review-event]").count(), 25);
    assert.equal(await drawer.locator(".death-review-summary .ant-tag").count(), 2);
    assert.ok(fixture.calls >= 2);
    const events = drawer.getByRole("region", { name: "死亡窗口事件明细", exact: true });
    await events.locator(".ant-pagination-next").click();
    assert.equal(await events.locator("[data-review-event]").first().getAttribute("data-review-event"), "review-25");
    await drawer.getByRole("button", { name: "相关 · 视角乙视角", exact: true }).click();
    await page.waitForFunction(() => { const video = document.querySelector("video[aria-label$='团队回放']"); return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 4) < .15; });
    assert.equal(await drawer.isVisible(), true);
    await page.screenshot({ path: path.join(output, "native-cloud-death-review.png"), fullPage: true });
  });
  await run("原生团队死亡未配置／换版不冒充空窗口，重新读取恢复", async () => {
    for (const mode of ["notConfigured", "reportChanged"]) {
      fixture.mode = mode;
      await drawer.getByRole("button", { name: "重新读取死亡明细", exact: true }).click();
      await drawer.getByText("协议测试：WCL来源暂不可用，请重新读取。", { exact: true }).waitFor();
      assert.equal(await drawer.locator("[data-review-event]").count(), 0);
      fixture.mode = "ready";
      await drawer.getByRole("button", { name: "重新读取死亡明细", exact: true }).click(); await ready();
    }
    assert.ok(fixture.refreshes >= 4);
  });
  await run("原生团队死亡换凭证清除快照并拒绝迟到页", async () => {
    fixture.mode = "hold";
    await drawer.getByRole("button", { name: "重新读取死亡明细", exact: true }).click();
    await waitUntil(async () => fixture.held, Boolean, "死亡窗口请求进入等待");
    await invoke("set_cloud_settings", { settings: { endpoint: origin, teamId: team, token: tokens[1] } });
    await drawer.waitFor({ state: "hidden", timeout: 15000 });
    fixture.release(); fixture.mode = "ready";
    await invoke("set_cloud_settings", { settings: { endpoint: origin, teamId: team, token: tokens[0] } });
    await invoke("verify_cloud_connection");
    assert.equal(await drawer.locator("[data-review-event]:visible").count(), 0);
    await page.getByRole("navigation").getByRole("button", { name: "个人中心" }).click();
  });
};
