const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const resources = path.resolve(__dirname, "../src-tauri/resources");

function verify(root, record) {
  const bytes = fs.readFileSync(path.join(root, record.file));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), record.sha256, record.file);
  assert.equal(bytes.length, record.bytes, record.file);
  return bytes;
}

test("隔离探测运行时的逐文件摘要、架构及 libav 依赖闭包有效", () => {
  const root = path.join(resources, "ffmpeg-runtime/probe");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const names = new Set(manifest.files.map((record) => record.file.toLowerCase()));
  for (const record of manifest.files) {
    const bytes = verify(path.join(root, "bin"), record);
    const pe = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.readUInt16LE(pe + 4), 0x8664);
    for (const dependency of record.imports.filter((name) => /^(avcodec|avformat|avutil|avfilter|avdevice|swscale|swresample)-/i.test(name))) {
      assert.ok(names.has(dependency.toLowerCase()), dependency);
    }
  }
  assert.ok(!names.has("avcodec-62.dll"));
  assert.ok(names.has("ffprobe.exe"));
});

test("技能资料的每张随包图片与来源快照匹配", () => {
  const root = path.join(resources, "game-data");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  for (const record of manifest.files) {
    const bytes = verify(root, record);
    if (record.file.endsWith(".jpg")) assert.ok(bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])));
    if (record.file.endsWith(".png")) assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  }
  const pack = JSON.parse(fs.readFileSync(path.join(root, "spells.json"), "utf8"));
  assert.equal(new Set(pack.spells.map((spell) => spell.spellId)).size, pack.spells.length);
  for (const spell of pack.spells) assert.ok(fs.existsSync(path.join(root, "icons", spell.icon)), spell.icon);
});

test("真实战斗技能覆盖、FileDataID来源与缺图清单一致", () => {
  const root = path.join(resources, "game-data");
  const pack = JSON.parse(fs.readFileSync(path.join(root, "spells.json"), "utf8"));
  const mapping = JSON.parse(fs.readFileSync(path.join(root, "source-map.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const records = new Map(pack.spells.map((record) => [record.spellId, record]));
  const covered = new Set(mapping.mappings.map((record) => record.spellId));
  assert.equal(mapping.build, "12.1.5.70391");
  assert.equal(mapping.exactLogBuildKnown, false);
  assert.equal(mapping.coverage.sampleSpellCount, 1036);
  assert.ok(mapping.coverage.bundledSampleSpellCount >= 1000);
  assert.equal(mapping.coverage.bundledSampleSpellCount, 1036);
  assert.equal(covered.size, mapping.coverage.bundledSampleSpellCount);
  assert.equal(covered.size + mapping.coverage.missing.length, 1036);
  assert.ok(mapping.coverage.missing.every((record) => !covered.has(record.spellId)));
  for (const record of mapping.mappings) {
    assert.equal(records.get(record.spellId).icon, record.icon);
    assert.ok(Number.isInteger(record.fileDataId) && record.fileDataId > 0);
    assert.ok(record.file?.startsWith("interface/icons/") || record.imageSource === "localCasc" && record.file === null);
    assert.match(records.get(record.spellId).source, /Wago SpellMisc.*verified-listfile/);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "icons", record.icon))).digest("hex"), record.iconSha256);
    if (record.imageSource === "localCasc") {
      assert.equal(record.downloadUrl, null);
      assert.equal(record.remoteIcon, null);
      assert.equal(record.icon, `filedataid_${record.fileDataId}.png`);
    } else assert.ok(record.downloadUrl.startsWith("https://assets.rpglogs.com/img/warcraft/abilities/"));
  }
  assert.equal(mapping.coverage.missing.length, 0);
  assert.equal(mapping.failedMappings.length, 0);
  for (const record of mapping.failedMappings) {
    assert.equal(record.iconSha256, null);
    assert.equal(record.candidateUrls.length, 2);
    if (record.remoteIcon.includes(" ")) assert.match(record.icon, /^filedataid_\d+\.jpg$/);
  }
  assert.deepEqual(manifest.coverage, mapping.coverage);
  assert.ok(manifest.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256) && source.bytes > 0));
  assert.ok(fs.statSync(path.join(root, "spells.json")).size <= 2 * 1024 * 1024);
});

test("本地CASC补图保留独立构建与原始内容摘要，不伪造文件名或下载来源", () => {
  const root = path.join(resources, "game-data");
  const mapping = JSON.parse(fs.readFileSync(path.join(root, "source-map.json"), "utf8"));
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "local-icons.json"), "utf8"));
  assert.equal(receipt.build, "12.1.5.70448");
  assert.equal(mapping.localCasc.build, receipt.build);
  assert.notEqual(receipt.build, mapping.build);
  assert.equal(receipt.tool.sha256, "c478346e9fbae3be275d2089f1c38175e81950785b0b05cb8858c1ddd4692df7");
  assert.equal(receipt.files.length, 10);
  assert.equal(new Set(receipt.files.map((row) => row.fileDataId)).size, 10);
  const local = mapping.mappings.filter((row) => row.imageSource === "localCasc");
  assert.deepEqual(local.map((row) => row.spellId).sort((a, b) => a - b),
    [6262, 19434, 114052, 385727, 452930, 1235110, 1235111, 1295924, 1295942, 1308693, 1310414]);
  assert.equal(local.find((row) => row.spellId === 1310414).file, null);
  for (const row of receipt.files) {
    assert.match(row.contentMd5, /^[a-f0-9]{32}$/);
    assert.match(row.blp.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(row.dimensions, [64, 64]);
    const image = fs.readFileSync(path.join(root, "icons", row.icon));
    assert.equal(image.length, row.png.bytes);
    assert.equal(crypto.createHash("sha256").update(image).digest("hex"), row.png.sha256);
    assert.ok(local.some((record) => record.fileDataId === row.fileDataId && record.iconSha256 === row.png.sha256));
  }
});
