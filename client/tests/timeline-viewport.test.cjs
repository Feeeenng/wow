const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("./source-loader.cjs");
const { timelineWindow, rulerTimes, formatTimelineTime } = loadSource("src/pages/replay/timeline/viewport/model.ts");

test("超过4倍仍按真实时间缩放，画面仅需当前窗口", () => {
  const view = timelineWindow(300, 800, 256, 120);
  assert.equal(view.zoom, 256);
  assert.equal(view.start, 120);
  assert.equal(view.span, 12.5 / 256);
  assert.ok(view.end < 121);
});

test("默认逐秒留足64px，长战斗不会被压成全场缩略图", () => {
  const view = timelineWindow(300, 800, 1, 0);
  assert.equal(view.span, 12.5);
  assert.equal(rulerTimes(0, view.end, 800).step, 1);
});

test("不同技能或来源分排，同技能邻近分组不会混合详情或改写原时间", () => {
  const { layoutSkillMarkers } = loadSource("src/pages/replay/timeline/viewport/markers.ts");
  const event = (spellId, pullTimeMs, sourceGuid = "Player-1") => ({ spellId, pullTimeMs, sourceGuid, owner: "player", kind: "castSuccess" });
  const input = [event(17, 1000), event(642, 1000), event(17, 1001), event(17, 1002, "Player-2"), event(17, 4000)];
  const markers = layoutSkillMarkers(input, 0, 10, 640, 30);
  assert.equal(markers.length, 4);
  assert.equal(markers[0].events.length, 2);
  assert.notEqual(markers[0].lane, markers[1].lane);
  assert.notEqual(markers[0].lane, markers[2].lane);
  assert.equal(markers[3].lane, 0);
  assert.equal(input[2].pullTimeMs, 1001);
  assert.ok(markers.every((marker) => new Set(marker.events.map((item) => item.spellId)).size === 1));
});

test("高倍及首尾平移以日志毫秒精度为界，不出现负数或超出战斗", () => {
  const view = timelineWindow(3600, 800, Number.MAX_VALUE, 9999);
  assert.equal(view.span, 0.001);
  assert.equal(view.end, 3600);
  assert.equal(timelineWindow(300, 800, 2, -100).start, 0);
  assert.equal(timelineWindow(0, 800, 2, 100).span, 0);
  for (const zoom of [NaN, Infinity, -1, 0]) assert.equal(timelineWindow(300, 800, zoom, NaN).zoom, 1);
});

test("任意时间窗的内部刻度仍对齐绝对秒，首尾保留且标签不挤压", () => {
  const { labels, step } = rulerTimes(100.35, 110.35, 800);
  assert.equal(step, 1);
  assert.equal(labels[0], 100.35);
  assert.equal(labels.at(-1), 110.35);
  assert.ok(labels.slice(1, -1).every(Number.isInteger));
  for (let i = 1; i < labels.length; i++) assert.ok((labels[i] - labels[i - 1]) / 10 * 800 >= 64 - 0.01);
});

test("毫秒窗口不会丢失端点或显示为相同整秒", () => {
  const { labels } = rulerTimes(1, 1.001, 800);
  assert.deepEqual(labels, [1, 1.001]);
  assert.equal(formatTimelineTime(labels[0], true), "0:01.000");
  assert.equal(formatTimelineTime(labels[1], true), "0:01.001");
  assert.deepEqual(rulerTimes(0, 0, 0).labels, [0]);
});

test("较长的毫秒末端标签不挤占相邻整秒", () => {
  const { labels } = rulerTimes(4.571, 14.707, 944);
  assert.ok(!labels.includes(14));
  assert.equal(labels.at(-1), 14.707);
  assert.ok((labels.at(-1) - labels.at(-2)) / (14.707 - 4.571) * 944 >= 80);
});

test("毫秒标签的首尾单边展开，不能只按居中标签间距布局", () => {
  const start = 5.253, end = 6.509;
  const { labels } = rulerTimes(start, end, 944);
  assert.ok((labels[1] - start) / (end - start) * 944 >= 120);
  assert.ok((end - labels.at(-2)) / (end - start) * 944 >= 120);
});
