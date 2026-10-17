const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadSource } = require("./source-loader.cjs");
const { historyRanges, historyCovers, historyMediaTime } = loadSource("src/features/live/history/mapping.ts");

test("直播窗口以节目时间为准，保留缺口并隔离上一会话", () => {
  const origin = Date.parse("2026-10-16T12:00:00Z");
  const manifest = { sessionStartedAtUnixMs: origin + 1000, segments: [
    { programDateTime: new Date(origin).toISOString(), durationSeconds: 4, discontinuity: false },
    { programDateTime: new Date(origin + 4000).toISOString(), durationSeconds: 4, discontinuity: false },
    { programDateTime: new Date(origin + 12000).toISOString(), durationSeconds: 4, discontinuity: true },
  ] };
  const ranges = historyRanges(manifest);
  assert.deepEqual(ranges, [{ startMs: origin + 1000, endMs: origin + 8000 }, { startMs: origin + 12000, endMs: origin + 16000 }]);
  assert.equal(historyCovers(ranges, origin + 10000), false);
  assert.equal(historyCovers(ranges, origin), false);
  assert.equal(historyCovers(ranges, origin + 16000), false);
});

test("历史定位使用媒体片段实际 PTS，不把滚动清单首片当作媒体零点", () => {
  const fragments = [{ start: 103.4, duration: 4, programDateTime: 10000 }, { start: 107.4, duration: 4, programDateTime: 14000 }];
  assert.equal(historyMediaTime(fragments, 15500), 108.9);
  assert.equal(historyMediaTime(fragments, 8000), null);
  assert.equal(historyMediaTime(fragments, Number.NaN), null);
});

test("墙钟回跳产生重叠区间时拒绝歧义跳转", () => {
  assert.equal(historyCovers([{ startMs: 0, endMs: 8000 }, { startMs: 4000, endMs: 10000 }], 6000), false);
  assert.equal(historyMediaTime([{ start: 0, duration: 8, programDateTime: 0 }, { start: 8, duration: 6, programDateTime: 4000 }], 6000), null);
});
