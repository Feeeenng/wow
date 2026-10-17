const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("./source-loader.cjs");
const { effectiveOffset, sharedOffset, personalOffsetStale } = loadSource("../shared/replay/calibration.ts");
const { pullToVideo, videoToPull } = loadSource("../shared/replay/mapping.ts");

const recording = () => ({ sourceKind: "cloud", pullId: "pov-a", cloudPlaybackVersion: "published-a",
  sharedCalibration: { active: true, stale: false, playbackVersion: "published-a", savedPlaybackVersion: "published-a", offsetMs: 500 },
  mapping: { clockDiscontinuous: false, hasGap: false, mediaCalibrated: true, mediaDurationMs: 14000,
    intervals: [{ pullStartMs: -2000, pullEndMs: 12000, videoStartMs: 0, videoEndMs: 14000 }] } });

test("团队与个人偏移只相加一次，正反映射保留共同战斗点", () => {
  const view = recording(), before = JSON.stringify(view);
  const offset = effectiveOffset(view, { offsetsMs: { "pov-a": -200 }, offsetVersions: { "pov-a": "published-a" } });
  assert.equal(offset, 300);
  assert.equal(pullToVideo(view, 3, offset).seconds, 5.3);
  assert.equal(videoToPull(view, 5.3, offset).seconds, 3);
  assert.equal(JSON.stringify(view), before);
});

test("发布版本变化、过期状态或本地视角不能应用旧团队值", () => {
  for (const view of [{ ...recording(), cloudPlaybackVersion: "published-b" }, { ...recording(), sourceKind: "local" },
    { ...recording(), sharedCalibration: { ...recording().sharedCalibration, stale: true } },
    { ...recording(), sharedCalibration: { ...recording().sharedCalibration, active: false } }]) {
    assert.equal(sharedOffset(view), 0);
    assert.equal(effectiveOffset(view, { offsetsMs: { "pov-a": 100 }, offsetVersions: { "pov-a": view.cloudPlaybackVersion } }), 100);
  }
  assert.equal(sharedOffset({ ...recording(), sharedCalibration: null }), 0);
});

test("各视角保留独立共享及本机值，移出有效范围仍拒绝定位", () => {
  const a = recording(), b = { ...recording(), pullId: "pov-b", sharedCalibration: { ...recording().sharedCalibration, offsetMs: -500 } };
  const preferences = { offsetsMs: { "pov-a": 100, "pov-b": -100 }, offsetVersions: { "pov-a": "published-a", "pov-b": "published-a" } };
  assert.equal(pullToVideo(a, 4, effectiveOffset(a, preferences)).seconds, 6.6);
  assert.equal(pullToVideo(b, 4, effectiveOffset(b, preferences)).seconds, 5.4);
  assert.equal(pullToVideo(a, 11.9, effectiveOffset(a, preferences)).kind, "gap");
});

test("换版或旧未绑定本机偏移保留为待复核，明确重新绑定后才应用", () => {
  const view = recording(), previous = { offsetsMs: { "pov-a": 100 }, offsetVersions: { "pov-a": "old-version" } };
  assert.equal(personalOffsetStale(view, previous), true);
  assert.equal(effectiveOffset(view, previous), 500);
  assert.equal(effectiveOffset(view, { offsetsMs: previous.offsetsMs }), 500);
  assert.equal(previous.offsetsMs["pov-a"], 100);
  assert.equal(effectiveOffset(view, { ...previous, offsetVersions: { "pov-a": "published-a" } }), 600);
  assert.equal(effectiveOffset({ ...view, sourceKind: "local" }, previous), 100);
});
