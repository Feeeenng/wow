const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("./source-loader.cjs");
const { readDeathReview } = loadSource("src/features/replay/review/reading.ts");
const { reviewScopeMatches, reviewViewTarget } = loadSource("src/features/replay/review/navigation.ts");
const { observedAuras, reviewAmounts } = loadSource("../shared/review/model.ts");
const event = (id, more = {}) => ({ eventId: id, pullTimeMs: 500, kind: "damage", sourceGuid: "Creature-X", sourceName: "相同名字",
  targetGuid: "Player-Victim", targetName: "死者", spellId: 1, spellName: "技能", amount: null, absorbed: null, overkill: null, overheal: null, health: null, maxHealth: null, stackCount: null, ...more });
const page = (more = {}) => ({ revision: "snapshot", sourceKind: "combatLog", availability: "ready", message: null,
  death: event("death", { kind: "death", pullTimeMs: 1000 }), windowStartMs: 0, windowEndMs: 1000,
  events: [event("a")], priorAuras: [event("prior", { kind: "buffApply", pullTimeMs: -100 })], total: 2,
  observedCount: 2, truncated: false, priorAurasTruncated: false, parseErrors: 0, pairedRowsRemoved: 0,
  victimRecordingIds: [], relatedRecordingIds: [], nextCursor: "snapshot:1", hasMore: true, ...more });

test("团队死亡分页明确使用WCL来源，不能混入本地页或跨来源复用视角", async () => {
  const cloud = page({ sourceKind: "wcl", hasMore: false, total: 1 });
  const result = await readDeathReview("death", async () => cloud, () => true, () => {}, "wcl");
  assert.equal(result.sourceKind, "wcl");
  await assert.rejects(readDeathReview("death", async () => cloud, () => true, () => {}), /来源/);
  await assert.rejects(readDeathReview("death", async () => page(), () => true, () => {}, "wcl"), /来源/);
  const recording = { sourceKind: "cloud", pullId: "same", battleKey: "team:pull" };
  assert.equal(reviewScopeMatches(recording, { pullId: "same", battleKey: "team:pull" }), false);
  assert.equal(reviewScopeMatches(recording, { pullId: "same", battleKey: "team:pull", source: "cloud" }), true);
  assert.equal(reviewScopeMatches({ ...recording, pullId: "another", battleKey: "other-team:pull" }, { pullId: "same", battleKey: "team:pull", source: "cloud" }), false);
});

test("死亡分页固定快照、保留首屏光环并递增进度，不修改原页", async () => {
  const first = page(), second = page({ events: [event("b", { pullTimeMs: 800 })], priorAuras: [], hasMore: false });
  const original = JSON.stringify(first), progress = [], cursors = [];
  const result = await readDeathReview("death", async (cursor) => { cursors.push(cursor); return cursor ? second : first; }, () => true, (value) => progress.push(value.events.length));
  assert.deepEqual(result.events.map((row) => row.eventId), ["a", "b"]); assert.equal(result.priorAuras.length, 1);
  assert.deepEqual(cursors, [null, "snapshot:1"]); assert.deepEqual(progress, [1, 2]); assert.equal(JSON.stringify(first), original);
});

test("死亡分页拒绝混版、混死亡、重复、越界、无推进及错误总量", async () => {
  for (const second of [page({ revision: "changed" }), page({ death: event("other") }), page(),
    page({ events: [event("b", { pullTimeMs: 2000 })] }), page({ events: [], hasMore: true }),
    page({ events: [event("b", { pullTimeMs: 400 })], hasMore: false }),
    page({ events: [event("b")], nextCursor: "snapshot:1", total: 3 }), page({ events: [], hasMore: false })]) {
    let calls = 0;
    await assert.rejects(readDeathReview("death", async () => calls++ ? second : page(), () => true, () => {}));
    assert.ok(calls <= 2);
  }
  await assert.rejects(readDeathReview("death", async () => page({ total: 5001 }), () => true, () => {}));
  let repeated = 0;
  await assert.rejects(readDeathReview("death", async () => page({ total: 3, events: [event(repeated++ ? "b" : "a")] }), () => true, () => {}), /没有推进/);
  assert.equal(repeated, 2);
});

test("死亡窗口取消后不发布迟到页，缺失来源区别于完整空窗口", async () => {
  let active = true, published = 0;
  const canceled = await readDeathReview("death", async () => { active = false; return page(); }, () => active, () => published++);
  assert.equal(canceled, null); assert.equal(published, 0);
  const missing = await readDeathReview("death", async () => page({ availability: "missingLog", events: [], total: 0, hasMore: false }), () => true, () => {});
  assert.equal(missing.availability, "missingLog");
});

test("来源数值未知不补零，零值保留，溢出不伪造合计", () => {
  const sums = reviewAmounts([event("a"), event("b", { amount: 0 }), event("c", { amount: 10 }), event("d", { kind: "heal", amount: null })]);
  assert.deepEqual(sums.damage, { count: 3, knownCount: 2, amount: 10, overflow: false });
  assert.equal(sums.healing.amount, null);
  const overflow = reviewAmounts([event("a", { amount: Number.MAX_SAFE_INTEGER }), event("b", { amount: 1 })]);
  assert.equal(overflow.damage.amount, null); assert.equal(overflow.damage.overflow, true);
});

test("光环按目标及来源身份区分，未知来源移除不误删另一类型", () => {
  const prior = [event("one", { kind: "buffApply", sourceGuid: "Player-A", pullTimeMs: 0 }), event("two", { kind: "buffApply", sourceGuid: "Player-B", pullTimeMs: 0 }),
    event("debuff", { kind: "debuffApply", sourceGuid: "Player-A", pullTimeMs: 0 }), event("other", { kind: "buffApply", targetGuid: "Player-Other", pullTimeMs: 0 })];
  const result = observedAuras(prior, [event("remove", { kind: "buffRemove", sourceGuid: "" }), event("late", { kind: "buffApply", pullTimeMs: 2000 })], page().death);
  assert.equal(result.events.length, 1); assert.equal(result.events[0].kind, "debuffApply"); assert.equal(result.ambiguousRemoval, true);
});

test("死亡视角只认同场，优先窗口／缺片退死亡点，偏移越界与未就绪拒绝", () => {
  const scope = { pullId: "own", battleKey: "battle" }, review = page({ windowStartMs: 0, death: event("death", { pullTimeMs: 8500 }) });
  const recording = { pullId: "related", battleKey: "battle", state: "ready", playbackUrl: "controlled", mapping: { mediaCalibrated: true, clockDiscontinuous: false, intervals: [{ pullStartMs: 0, pullEndMs: 10000, videoStartMs: 0, videoEndMs: 10000 }] } };
  const prefs = { offsetsMs: {} };
  assert.equal(reviewViewTarget(recording, scope, review, prefs), 0);
  const gap = { ...recording, mapping: { ...recording.mapping, intervals: [{ pullStartMs: 5000, pullEndMs: 10000, videoStartMs: 0, videoEndMs: 5000 }] } };
  assert.equal(reviewViewTarget(gap, scope, review, prefs), 8.5);
  assert.equal(reviewViewTarget(recording, scope, review, { offsetsMs: { related: 999999 } }), null);
  assert.equal(reviewViewTarget({ ...recording, state: "failed" }, scope, review, prefs), null);
  assert.equal(reviewScopeMatches({ ...recording, battleKey: "same-boss-other-pull" }, scope), false);
  assert.equal(reviewScopeMatches({ ...recording, sourceKind: "cloud" }, scope), false);
  assert.equal(reviewScopeMatches({ ...recording, pullId: "own", battleKey: null }, { ...scope, battleKey: null }), true);
});
