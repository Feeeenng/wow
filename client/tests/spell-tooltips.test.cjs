const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../src-tauri/resources/game-data");
const pack = JSON.parse(fs.readFileSync(path.join(root, "spell-tooltips.json"), "utf8"));

test("真实离线技能说明覆盖玩家和已观测史诗首领，保留动态数值边界", () => {
  const spells = new Map(pack.spells.map((spell) => [spell.spellId, spell]));
  assert.equal(spells.size, pack.spells.length);
  assert.equal(pack.build, "12.1.5.70391");
  for (const id of [17, 642, 269231, 1282487, 1299960]) {
    const spell = spells.get(id);
    assert.ok(spell?.description.length > 10, id);
    assert.ok(spell.englishName);
    assert.doesNotMatch(spell.description, /[$|<>]/);
  }
  const boss = spells.get(1282487);
  assert.match(boss.description, /自然伤害/);
  assert.match(boss.description, /8秒/);
  assert.match(boss.description, /数值/);
  assert.match(boss.rangeText, /300/);
  assert.equal(boss.dynamicValues, true);
  assert.match(boss.descriptionNote, /等级|难度|天赋/);
  // 没有说明的源记录保持缺失，不拿图标名称代替完整说明。
  assert.equal(spells.has(1308011), false);
  for (const spell of spells.values()) assert.doesNotMatch(spell.description, /[$|<>]/);
});
