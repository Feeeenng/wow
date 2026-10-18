const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/** 在真实Rust IPC及WebView2中读取补图；禁止网页CDN请求，Rust仍按既有路径优先读取随包文件。 */
exports.verifyNativeSpellIcons = async ({ page, invoke }) => {
  const root = path.resolve(__dirname, "../src-tauri/resources/game-data");
  const source = JSON.parse(fs.readFileSync(path.join(root, "source-map.json"), "utf8"));
  const expected = source.mappings.filter((row) => row.imageSource === "localCasc");
  assert.equal(expected.length, 11);
  const remote = [];
  const block = (route) => { remote.push(route.request().url()); return route.abort(); };
  await page.route("https://assets.rpglogs.com/**", block);
  await page.route("https://wow.zamimg.com/**", block);
  try {
    const records = await invoke("get_spell_metadata", { spellIds: [...expected.map((row) => row.spellId), 4294967294] });
    assert.equal(records.length, 11, "未知技能不应被伪造为已有图标");
    const checks = [];
    for (const item of expected) {
      const record = records.find((row) => row.spellId === item.spellId);
      assert.equal(record.iconUrl, `http://spell-icon.localhost/${item.icon}`);
      assert.match(record.source, /CASC artwork 12\.1\.5\.70448/);
      const actual = await page.evaluate(async (url) => {
        const response = await fetch(url);
        const bytes = [...new Uint8Array(await response.arrayBuffer())];
        const image = new Image(); image.src = url; await image.decode();
        return { status: response.status, type: response.headers.get("content-type"), bytes, width: image.naturalWidth, height: image.naturalHeight };
      }, record.iconUrl);
      assert.equal(actual.status, 200); assert.equal(actual.type, "image/png");
      assert.equal(actual.width, 64); assert.equal(actual.height, 64);
      assert.equal(crypto.createHash("sha256").update(Buffer.from(actual.bytes)).digest("hex"), item.iconSha256);
      checks.push({ spellId: item.spellId, fileDataId: item.fileDataId, status: actual.status, dimensions: [actual.width, actual.height], sha256: item.iconSha256 });
    }
    assert.deepEqual(remote, []);
    return { checks, remoteRequests: remote.length, boundary: "真实Rust随包资料、受限本地协议和WebView2图片解码；不冒充全部技能已在当前可见时间轴出现" };
  } finally {
    await page.unroute("https://assets.rpglogs.com/**", block);
    await page.unroute("https://wow.zamimg.com/**", block);
  }
};
