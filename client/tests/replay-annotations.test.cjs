const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSource } = require("./source-loader.cjs");
const { emptyAnnotationDocument, editAnnotations, undoAnnotations, redoAnnotations, visibleAnnotations, videoContentRect, annotationFrameTime } = loadSource("../shared/annotations/model.ts");

const item = (id, atMs = 1000) => ({ id, kind: "arrow", points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 }], color: "#E51039", width: 3, text: "", atMs, durationMs: 5000 });

test("空标注不是未保存草稿，保存快照和撤销只比较不可变引用", () => {
  const empty = emptyAnnotationDocument();
  assert.equal(empty.items, empty.savedItems);
  const initial = { ...empty, canEdit: true, loaded: true };
  const edited = editAnnotations(initial, [item("one")]);
  assert.notEqual(edited.items, edited.savedItems);
  const undone = undoAnnotations(edited);
  assert.equal(undone.items, initial.savedItems);
  const redone = redoAnnotations(undone);
  assert.deepEqual(redone.items, edited.items);
  assert.equal(initial.items.length, 0);
});

test("清空和元素属性修改可撤销，新增操作清除旧重做，不改原图形", () => {
  const original = item("one");
  const initial = { ...emptyAnnotationDocument(), loaded: true, canEdit: true, items: [original] };
  const changed = editAnnotations(initial, [{ ...original, color: "#FFFFFF" }]);
  assert.equal(original.color, "#E51039");
  const cleared = editAnnotations(changed, []);
  assert.deepEqual(undoAnnotations(cleared).items, changed.items);
  const branched = editAnnotations(undoAnnotations(changed), [item("new")]);
  assert.equal(branched.future.length, 0);
});

test("只读或保存中禁止改写，撤销历史有界", () => {
  const empty = emptyAnnotationDocument();
  assert.equal(editAnnotations(empty, [item("one")]), empty);
  const saving = { ...empty, canEdit: true, saving: true };
  assert.equal(editAnnotations(saving, [item("one")]), saving);
  let current = { ...empty, canEdit: true };
  for (let index = 0; index < 30; index++) current = editAnnotations(current, [item(String(index))]);
  assert.equal(current.past.length, 20);
});

test("视频黑边内归一化位置随宽高改变，空媒体无画布", () => {
  const fitted = videoContentRect({ left: 10, top: 20, width: 1000, height: 800 }, 1920, 1080);
  for (const [key, expected] of Object.entries({ left: 10, top: 138.75, width: 1000, height: 562.5 })) assert.ok(Math.abs(fitted[key] - expected) < 0.001);
  assert.deepEqual(videoContentRect({ left: 0, top: 0, width: 1000, height: 500 }, 1000, 1000), { left: 250, top: 0, width: 500, height: 500 });
  assert.equal(videoContentRect({ left: 0, top: 0, width: 1000, height: 500 }, 0, 0), null);
});

test("按共同战斗时间显示，隐藏到期标注但保留原快照", () => {
  const items = [item("early", 1000), item("later", 7000)];
  assert.deepEqual(visibleAnnotations(items, 0), []);
  assert.deepEqual(visibleAnnotations(items, 6000).map((value) => value.id), ["early"]);
  assert.deepEqual(visibleAnnotations(items, 6500), []);
  assert.deepEqual(visibleAnnotations(items, 8000).map((value) => value.id), ["later"]);
  assert.equal(items.length, 2);
});

test("实际媒体预滚和尾滚不冒充战斗边界，人工偏移与未知缺片统一保护", () => {
  const recording = { encounterStartUnixMs: 10000, encounterEndUnixMs: 20000, mapping: {
    actualStartUnixMs: 8000, actualEndUnixMs: 22000, videoZeroMs: 2000, hasGap: false,
    mediaDurationMs: 14000, mediaCalibrated: true, clockDiscontinuous: false,
    intervals: [{ pullStartMs: -2000, pullEndMs: 12000, videoStartMs: 0, videoEndMs: 14000 }],
  } };
  assert.equal(annotationFrameTime(recording, 1, 0), null);
  assert.equal(annotationFrameTime(recording, 13, 0), null);
  assert.equal(annotationFrameTime(recording, 2, 0), 0);
  assert.equal(annotationFrameTime(recording, 5, 0), 3000);
  assert.equal(annotationFrameTime(recording, 6, 1000), 3000);
  assert.equal(annotationFrameTime({ ...recording, mapping: { ...recording.mapping, mediaCalibrated: false, hasGap: true, intervals: [] } }, 5, 0), null);
});
