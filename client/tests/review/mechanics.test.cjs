const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("../source-loader.cjs");
const { classifiedMechanic, reviewMechanics } = loadSource("../shared/review/mechanics/classification.ts");
const { mechanicCatalog } = loadSource("../shared/review/mechanics/catalog.ts");
const death = { targetGuid: "Player-Victim", pullTimeMs: 15000 };
const event = (spellId, more = {}) => ({ spellId, eventId: "original", spellName: "任意名称", sourceGuid: "Player-Victim", targetGuid: "Player-Victim", kind: "buffApply", pullTimeMs: 10000, ...more });

test("分类按效果与身份，个人外部团队分别保留且不依姓名", () => {
  assert.deepEqual(classifiedMechanic(event(22812), death).kinds, ["reduction"]);
  assert.equal(classifiedMechanic(event(22812), death).scope, "personal");
  assert.equal(classifiedMechanic(event(102342, { sourceGuid: "Player-Healer" }), death).scope, "external");
  assert.equal(classifiedMechanic(event(465, { sourceGuid: "Player-Healer" }), death).scope, "group");
  assert.deepEqual(classifiedMechanic(event(642), death).kinds, ["immunity"]);
  assert.ok(classifiedMechanic(event(6940), death).kinds.includes("transfer"));
  assert.ok(classifiedMechanic(event(48707), death).kinds.includes("absorb"));
  assert.equal(classifiedMechanic(event(1490), death), null, "承伤增加不能标成减伤");
  assert.equal(classifiedMechanic(event(99999999, { spellName: "治疗石" }), death), null);
});

test("治疗石与药水需本人成功施法或治疗，复用治疗链的物品不能冒充耗材", () => {
  for (const spellId of [6262, 452930, 1262857, 1295247]) {
    assert.deepEqual(classifiedMechanic(event(spellId, { kind: "castSuccess" }), death).kinds, ["consumable"]);
    assert.equal(classifiedMechanic(event(spellId, { kind: "buffApply" }), death), null);
    assert.equal(classifiedMechanic(event(spellId, { kind: "heal", sourceGuid: "Player-Other" }), death), null);
  }
  assert.equal(classifiedMechanic(event(1064, { kind: "heal" }), death), null);
  assert.equal(classifiedMechanic(event(6262, { kind: "castStart" }), death), null);
});

test("无效来源不冒充外部减伤，施放给别人不能成为死者覆盖", () => {
  for (const sourceGuid of ["", "nil", "00000000", "0x0000000000000000", "Creature-Other"]) {
    assert.equal(classifiedMechanic(event(102342, { sourceGuid }), death).scope, "unknown");
  }
  assert.equal(classifiedMechanic(event(22812, { targetGuid: "Player-Other", kind: "castSuccess" }), death), null);
  assert.equal(classifiedMechanic(event(22812, { targetGuid: "nil", kind: "castSuccess" }), death).scope, "personal");
  assert.equal(classifiedMechanic(event(22812, { kind: "buffRemove" }), death), null);
});

test("窗口边界与来源隔离，保留原记录且施法和治疗不合并为次数", () => {
  const events = [event(6262, { kind: "castSuccess" }), event(6262, { kind: "heal", eventId: "heal" }), event(22812, { pullTimeMs: -1 }), event(22812, { pullTimeMs: 15001 })];
  const review = { sourceKind: "combatLog", events, death, windowStartMs: 0, windowEndMs: 15000 };
  const bytes = JSON.stringify(review), classified = reviewMechanics(review);
  assert.equal(classified.length, 2); assert.equal(classified[0].event, events[0]);
  assert.equal(JSON.stringify(review), bytes);
  assert.deepEqual(reviewMechanics({ ...review, sourceKind: "wcl" }), []);
});

test("资料每项保留DB2行证据，不收录承伤增加或未验证的杂项治疗物品", () => {
  const ids = mechanicCatalog.map((entry) => entry.spellId);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of mechanicCatalog) {
    assert.ok(entry.effects.length || entry.items.length);
    for (const effect of entry.effects) {
      assert.ok(effect.effectId > 0);
      if (effect.kind === "reduction") assert.ok(effect.aura === 87 && effect.points < 0);
    }
    for (const item of entry.items) assert.ok(item.itemEffectId > 0 && item.linkId > 0 && (item.subclass === 1 || [5512, 224464].includes(item.itemId)));
  }
});
