const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("./source-loader.cjs");
const { distinctRecordingBattles, recordingStatusLabel } = loadSource("src/pages/replay/model.ts");
const { pullToVideo, videoToPull, replayIntervals } = loadSource("../shared/replay/mapping.ts");
const { canAssignTimelineTrack, eventTrack, removePersonalTrack, trackOverrideKey, personalTrackNameError, assignTimelineTrack, defaultTimelineLayout } = loadSource("../shared/replay/tracks.ts");
const { groupMarkers } = loadSource("../shared/replay/markers.ts");
const { uploadTargets } = loadSource("src/pages/replay/uploading/targets.ts");

test("个人轨道Unicode名称边界、空白控制字符和重名一致拒绝", () => {
  const tracks = [{ id: "custom-a", name: "Focus" }];
  assert.equal(personalTrackNameError("  Focus  ", tracks, "custom-a"), null);
  assert.ok(personalTrackNameError("focus", tracks)); assert.ok(personalTrackNameError("  ", tracks));
  assert.ok(personalTrackNameError("名字\u0000", tracks)); assert.ok(personalTrackNameError("名字\u0085", tracks));
  assert.equal(personalTrackNameError("😀".repeat(32), tracks), null); assert.ok(personalTrackNameError("😀".repeat(33), tracks));
});

test("未知来源不生成合并覆盖，WCL报告actor身份及真实GUID保持可用", () => {
  const base = { owner: "player", spellId: 17, kind: "castSuccess", sourceGuid: "", targetGuid: "Player-Target" };
  for (const sourceGuid of ["", "nil", "0000000000000000", "0x0000000000000000"]) {
    const event = { ...base, sourceGuid }, overrides = {};
    assert.equal(canAssignTimelineTrack(event), false);
    assert.equal(assignTimelineTrack([event], overrides, [], trackOverrideKey(event), "team"), overrides);
  }
  assert.equal(canAssignTimelineTrack({ ...base, sourceGuid: "Player-Source" }), true);
  assert.equal(canAssignTimelineTrack({ ...base, identityNamespace: "wcl:AbCdEfGhIjKlMnOp", sourceActorId: 7 }), true);
  assert.equal(canAssignTimelineTrack({ ...base, sourceGuid: "Player-Source", spellId: 0 }), false);
});

test("个人分轨只作用当前真实规则，拒绝外来拖拽，删除覆盖和默认值不改事件", () => {
  const event = { owner: "player", spellId: 642, kind: "castSuccess", sourceGuid: "Player-A", pullTimeMs: 6000 };
  const another = { ...event, sourceGuid: "Player-B" }, values = [event, another];
  const before = JSON.stringify(values), tracks = [{ id: "custom-a", name: "关键时刻" }], rules = {};
  const key = trackOverrideKey(event), moved = assignTimelineTrack(values, rules, tracks, key, "custom-a");
  assert.equal(eventTrack(event, moved, tracks), "custom-a"); assert.equal(eventTrack(another, moved, tracks), "player");
  assert.equal(assignTimelineTrack(values, moved, tracks, "foreign", "custom-a"), moved);
  assert.equal(assignTimelineTrack(values, moved, tracks, key, "missing"), moved);
  assert.deepEqual(assignTimelineTrack(values, moved, tracks, key, "player"), {}); assert.deepEqual(rules, {});
  assert.equal(JSON.stringify(values), before);
  const first = defaultTimelineLayout(), second = defaultTimelineLayout(); first.customTimelineTracks.push(tracks[0]);
  assert.deepEqual(second.customTimelineTracks, []); assert.notEqual(first.timelineTrackOverrides, second.timelineTrackOverrides);
});

test("正负微调不能跨过拼接片段边界，双向映射保持同段身份", () => {
  const view = { mapping: { hasGap: true, clockDiscontinuous: false, mediaCalibrated: true, mediaDurationMs: 8000,
    intervals: [{ pullStartMs: 0, pullEndMs: 4000, videoStartMs: 0, videoEndMs: 4000 },
      { pullStartMs: 6000, pullEndMs: 10000, videoStartMs: 4000, videoEndMs: 8000 }] } };
  assert.equal(pullToVideo(view, 3.8, 500).kind, "gap");
  assert.equal(videoToPull(view, 4.3, 500).kind, "gap");
  assert.equal(pullToVideo(view, 6.2, -500).kind, "gap");
  assert.equal(videoToPull(view, 3.7, -500).kind, "gap");
  assert.equal(pullToVideo(view, 6.2, 500).seconds, 4.7);
  assert.equal(videoToPull(view, 4.7, 500).seconds, 6.2);
});

function recording(overrides = {}) {
  return { mapping: {
    actualStartUnixMs: 0, actualEndUnixMs: 10000, videoZeroMs: 0, hasGap: false,
    intervals: [], mediaDurationMs: 10000, mediaCalibrated: false, clockDiscontinuous: false,
    ...overrides,
  } };
}

test("晚起录保留负偏移，缺失开头不会映射到无关画面", () => {
  const value = recording({ videoZeroMs: -3000 });
  assert.equal(pullToVideo(value, 2).kind, "gap");
  assert.deepEqual(pullToVideo(value, 5), { kind: "mapped", seconds: 2 });
  assert.deepEqual(videoToPull(value, 2), { kind: "mapped", seconds: 5 });
});

test("拼接缺口双向换算，战斗缺口不会压缩到视频时间", () => {
  const value = recording({ hasGap: true, mediaCalibrated: true, mediaDurationMs: 8000, intervals: [
    { pullStartMs: 0, pullEndMs: 4000, videoStartMs: 0, videoEndMs: 4000 },
    { pullStartMs: 6000, pullEndMs: 10000, videoStartMs: 4000, videoEndMs: 8000 },
  ] });
  assert.equal(pullToVideo(value, 5).kind, "gap");
  assert.deepEqual(pullToVideo(value, 7), { kind: "mapped", seconds: 5 });
  assert.deepEqual(videoToPull(value, 5), { kind: "mapped", seconds: 7 });
  assert.equal(pullToVideo(value, 10).kind, "gap");
});

test("旧缺片与不连续时钟不补造可用映射", () => {
  assert.deepEqual(replayIntervals(recording({ hasGap: true })), []);
  assert.deepEqual(replayIntervals(recording({ clockDiscontinuous: true })), []);
  assert.equal(pullToVideo(recording({ hasGap: true }), 1).kind, "unavailable");
});

test("用户正负微调双向一致，视频边界之外明确失败", () => {
  const value = recording();
  assert.deepEqual(pullToVideo(value, 2, 500), { kind: "mapped", seconds: 2.5 });
  assert.deepEqual(videoToPull(value, 2.5, 500), { kind: "mapped", seconds: 2 });
  assert.equal(pullToVideo(value, 0, -500).kind, "gap");
  assert.equal(pullToVideo(value, 9.9, 500).kind, "gap");
  assert.equal(pullToVideo(value, NaN).kind, "unavailable");
  assert.equal(pullToVideo(value, 1, Infinity).kind, "unavailable");
});

test("显示分组不修改事件时间、目标或稳定 ID", () => {
  const events = [
    { eventId: "first", pullTimeMs: 2000, targetGuid: "Player-1" },
    { eventId: "second", pullTimeMs: 2000, targetGuid: "Player-2" },
  ];
  const before = JSON.stringify(events);
  const groups = groupMarkers(events, 10, 100);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].events.map((event) => event.eventId), ["first", "second"]);
  assert.equal(JSON.stringify(events), before);
});

test("窄宽度事件可分组，宽视口恢复独立标记", () => {
  const events = [{ eventId: "a", pullTimeMs: 2000 }, { eventId: "b", pullTimeMs: 4000 }];
  assert.equal(groupMarkers(events, 10, 100).length, 1);
  assert.equal(groupMarkers(events, 10, 1000).length, 2);
});

test("调整图标大小后按实际像素重新分组，保留原事件身份", () => {
  const events = [{ eventId: "a", pullTimeMs: 2000 }, { eventId: "b", pullTimeMs: 4000 }];
  assert.equal(groupMarkers(events, 10, 100, 24).length, 1);
  const small = groupMarkers(events, 10, 100, 10);
  assert.equal(small.length, 2);
  assert.deepEqual(small.map((group) => group.events[0].eventId), ["a", "b"]);
});

test("多视角列表仅按明确战斗身份折叠，保留已选视角", () => {
  const records = [
    { pullId: "observer-a", encounterId: 1, encounterStartUnixMs: 1000, battleKey: "report:1" },
    { pullId: "observer-b", encounterId: 1, encounterStartUnixMs: 1000, battleKey: "report:1" },
    { pullId: "unknown-a", encounterId: 1, encounterStartUnixMs: 1000 },
    { pullId: "unknown-b", encounterId: 1, encounterStartUnixMs: 1000 },
    { pullId: "other-report", encounterId: 1, encounterStartUnixMs: 1000, battleKey: "other:1" },
  ];
  assert.deepEqual(distinctRecordingBattles(records, "observer-b").map((item) => item.pullId), ["observer-b", "unknown-a", "unknown-b", "other-report"]);
});

test("拖轨规则只影响相同来源技能类型，事件事实和未知规则保持不变", () => {
  const event = { owner: "player", sourceGuid: "Player-1", spellId: 642, kind: "castSuccess", pullTimeMs: 6030, eventId: "raw:1" };
  const before = JSON.stringify(event);
  const overrides = { [trackOverrideKey(event)]: "team" };
  assert.equal(eventTrack(event, overrides), "team");
  assert.equal(eventTrack({ ...event, sourceGuid: "Player-2" }, overrides), "player");
  assert.equal(eventTrack({ ...event, kind: "buffApply" }, overrides), "aura");
  assert.equal(eventTrack(event, { [trackOverrideKey(event)]: "invented" }), "player");
  assert.equal(JSON.stringify(event), before);
});

test("团队文件上传、处理与播放发布分别表达，ready无地址不冒充可播放", () => {
  assert.equal(recordingStatusLabel({ cloudStatus: "uploaded", state: "waitingForPlayback", playbackUrl: null }), "文件已上传，待处理");
  assert.equal(recordingStatusLabel({ cloudStatus: "processing", state: "processing", playbackUrl: null }), "云端处理中");
  assert.equal(recordingStatusLabel({ cloudStatus: "ready", state: "ready", playbackUrl: null }), "等待发布播放文件");
  assert.equal(recordingStatusLabel({ cloudStatus: "ready", state: "ready", playbackUrl: "http://cloud-replay.localhost/fixture/index.m3u8" }), "云端可回放");
});

test("删除个人轨道只清除该轨覆盖，恢复默认且不改原偏好对象", () => {
  const event = { owner: "player", sourceGuid: "Player-1", spellId: 642, kind: "castSuccess", eventId: "raw-1", pullTimeMs: 6000 };
  const custom = [{ id: "custom-one", name: "个人复盘" }, { id: "custom-two", name: "另一轨道" }];
  const overrides = { [trackOverrideKey(event)]: "custom-one", other: "custom-two", shared: "team" };
  const before = JSON.stringify({ custom, overrides, event });
  assert.equal(eventTrack(event, overrides, custom), "custom-one");
  const next = removePersonalTrack(custom, overrides, "custom-one");
  assert.equal(eventTrack(event, next.timelineTrackOverrides, next.customTimelineTracks), "player");
  assert.deepEqual(next.customTimelineTracks, [custom[1]]);
  assert.deepEqual(next.timelineTrackOverrides, { other: "custom-two", shared: "team" });
  assert.equal(JSON.stringify({ custom, overrides, event }), before);
});

test("空GUID的WCL同名人物按报告actor独立覆盖，绑定真实GUID优先", () => {
  const source = { owner: "team", sourceGuid: "", spellId: 17, kind: "castSuccess", identityNamespace: "wcl:abcdefghijklmnop", sourceActorId: 1 };
  assert.equal(trackOverrideKey(source), "team:17:castSuccess:WCL-abcdefghijklmnop-1");
  assert.notEqual(trackOverrideKey(source), trackOverrideKey({ ...source, sourceActorId: 2 }));
  assert.equal(trackOverrideKey({ ...source, sourceGuid: "Player-bound" }), "team:17:castSuccess:Player-bound");
});

test("上传目标仅用明确场次UUID及精确首领难度，绝不按时间或姓名猜测", () => {
  const first = "00000000-0000-4000-8000-000000000001", second = "00000000-0000-4000-8000-000000000002";
  const source = { encounterId: 10, difficultyId: 16 };
  const values = [
    { ...source, cloudTeamPullId: first, encounterName: "首领", encounterStartUnixMs: 1000 },
    { ...source, cloudTeamPullId: first, encounterName: "首领", encounterStartUnixMs: 1000 },
    { ...source, cloudTeamPullId: second, encounterName: "首领", encounterStartUnixMs: 9999999999 },
    { ...source, cloudTeamPullId: first, encounterId: 11, encounterName: "同名首领", encounterStartUnixMs: 1000 },
    { ...source, cloudTeamPullId: first, difficultyId: 15, encounterName: "首领", encounterStartUnixMs: 1000 },
    { ...source, battleKey: `team:${first}`, encounterName: "首领", encounterStartUnixMs: 1000 },
    { ...source, cloudTeamPullId: "untrusted-id", encounterName: "首领", encounterStartUnixMs: 1000 },
  ];
  const before = JSON.stringify(values);
  const targets = uploadTargets(values, source);
  assert.deepEqual(targets.map((target) => target.id), [first, second]);
  assert.equal(targets[0].recordingCount, 2);
  assert.equal(JSON.stringify(values), before);
});
