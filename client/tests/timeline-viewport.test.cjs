const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("./source-loader.cjs");
const { timelineWindow, rulerTimes, formatTimelineTime } = loadSource("src/pages/replay/timeline/viewport/model.ts");

test("超过4倍仍按真实时间缩放，画面仅需当前窗口", () => {
  const view = timelineWindow(300, 800, 256, 120);
  assert.equal(view.zoom, 256);
  assert.equal(view.start, 120);
  assert.equal(view.span, 100 / 256);
  assert.ok(view.end < 121);
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
