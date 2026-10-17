const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("./source-loader.cjs");
const { readEventSnapshot } = loadSource("../shared/replay/events.ts");
const { eventActorKey, eventActorIsPlayer } = loadSource("../shared/replay/identity.ts");
const { parseWclReference } = loadSource("../shared/replay/reports.ts");
const { eventLabels } = loadSource("../shared/replay/events.ts");
const { eventTrack } = loadSource("../shared/replay/tracks.ts");

const empty = () => ({ events: [], cursor: null, revision: null });
const event = (eventId, targetGuid) => ({ eventId, pullTimeMs: 1000, targetGuid });
const page = (events, options = {}) => ({ events, nextCursor: "end", revision: "v1", total: events.length, hasMore: false, reset: false, ...options });

test("事件分页读取到末页后才发布完整快照，同毫秒不同目标不丢失", async () => {
  const pages = [page([event("a", "Player-1")], { nextCursor: "first", hasMore: true, total: 2 }), page([event("b", "Player-2")], { total: 2 })];
  const cursors = [];
  const progress = [];
  const result = await readEventSnapshot(empty(), async (cursor) => { cursors.push(cursor); return pages.shift(); }, () => true, (...value) => progress.push(value));
  assert.deepEqual(cursors, [null, "first"]);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.deepEqual(result.events.map((item) => item.targetGuid), ["Player-1", "Player-2"]);
});

test("末页游标续读纯追加，重建信号替换旧快照", async () => {
  const first = await readEventSnapshot(empty(), async () => page([event("a", "Player-1")]), () => true, () => {});
  const appended = await readEventSnapshot(first, async () => page([event("b", "Player-2")], { revision: "v2" }), () => true, () => {});
  assert.deepEqual(appended.events.map((item) => item.eventId), ["a", "b"]);
  const replaced = await readEventSnapshot(appended, async () => page([event("a", "Player-3")], { revision: "v3", reset: true }), () => true, () => {});
  assert.deepEqual(replaced.events.map((item) => item.targetGuid), ["Player-3"]);
  assert.equal(first.events.length, 1);
});

test("离开或换场时丢弃旧请求，失败不返回半场结果", async () => {
  let active = true;
  let observed = false;
  const cancelled = await readEventSnapshot(empty(), async () => { active = false; return page([event("a", "Player-1")]); }, () => active, () => { observed = true; });
  assert.equal(cancelled, null);
  assert.equal(observed, false);
  let calls = 0;
  await assert.rejects(readEventSnapshot(empty(), async () => {
    if (++calls === 2) throw new Error("模拟第二页读取失败");
    return page([event("a", "Player-1")], { nextCursor: "first", hasMore: true });
  }, () => true, () => {}), /第二页读取失败/);
});

test("未推进的分页游标显式报错，空末页保留原快照", async () => {
  const initial = { events: [event("a", "Player-1")], cursor: "end", revision: "v1" };
  await assert.rejects(readEventSnapshot(initial, async () => page([], { hasMore: true }), () => true, () => {}), /游标未推进/);
  const unchanged = await readEventSnapshot(initial, async () => page([]), () => true, () => {});
  assert.deepEqual(unchanged.events, initial.events);
});

test("WCL 同名人物按报告及 actor 区分，不把报告 ID 冒充游戏 GUID", () => {
  const first = { sourceGuid: "", targetGuid: "", sourceName: "同名角色", identityNamespace: "wcl:abcdefghijklmnop", sourceActorId: 1, sourceIsPlayer: true };
  const second = { ...first, sourceActorId: 2 };
  assert.notEqual(eventActorKey(first, "source"), eventActorKey(second, "source"));
  assert.notEqual(eventActorKey(first, "source"), eventActorKey({ ...first, identityNamespace: "wcl:ponmlkjihgfedcba" }, "source"));
  assert.equal(eventActorIsPlayer(first, "source"), true);
  assert.equal(eventActorKey({ ...first, sourceActorId: null }, "source"), "");
  assert.equal(eventActorKey({ ...first, sourceGuid: "Player-real-guid" }, "source"), "Player-real-guid");
  assert.equal(eventActorIsPlayer({ ...first, sourceIsPlayer: false }, "source"), false);
});

test("WCL 链接只提取公开报告身份，拒绝外域、伪后缀、嵌入凭证和非法 fight", () => {
  assert.deepEqual(parseWclReference("https://cn.warcraftlogs.com/reports/abcdefghijklmnop#fight=12&type=casts"), { reportCode: "abcdefghijklmnop", fightId: 12 });
  assert.deepEqual(parseWclReference("abcdefghijklmnop"), { reportCode: "abcdefghijklmnop", fightId: null });
  assert.equal(parseWclReference("https://evilwarcraftlogs.com/reports/abcdefghijklmnop"), null);
  assert.equal(parseWclReference("https://warcraftlogs.com.evil.test/reports/abcdefghijklmnop"), null);
  assert.equal(parseWclReference("https://secret@cn.warcraftlogs.com/reports/abcdefghijklmnop"), null);
  assert.equal(parseWclReference("http://cn.warcraftlogs.com/reports/abcdefghijklmnop"), null);
  assert.equal(parseWclReference("https://cn.warcraftlogs.com/reports/abcdefghijklmnop#fight=-1").fightId, null);
});

test("刷新、蓄力和复活可独立筛选及分轨，不合并来源事件", () => {
  const added = ["buffRefresh", "debuffRefresh", "empowerStart", "empowerEnd", "empowerInterrupt", "resurrect"];
  assert.equal(new Set(added.map((kind) => eventLabels[kind])).size, added.length);
  for (const kind of added) {
    const item = { eventId: kind, owner: "player", sourceGuid: "Player-1", kind, spellId: 17 };
    assert.equal(eventTrack(item, {}), kind.endsWith("Refresh") ? "aura" : "player");
    assert.equal(eventTrack(item, { [`player:17:${kind}:Player-1`]: "team" }), "team");
    assert.equal(item.kind, kind);
  }
});
