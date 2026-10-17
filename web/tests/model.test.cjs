const test = require("node:test");
const assert = require("node:assert/strict");
global.window = { location: { origin: "http://127.0.0.1:1421" }, setTimeout, clearTimeout };
const { load } = require("./source-loader.cjs");
const { WebApi } = load("src/auth/api.ts");
const { normalizeEntry, businessClock, businessDate } = load("src/replay/catalog/model.ts");
const { readReplayLink, replayLink } = load("src/replay/navigation.ts");
const team = "11111111-1111-4111-8111-111111111111", record = "22222222-2222-4222-8222-222222222222", version = "33333333-3333-4333-8333-333333333333";
const raw = () => ({ teamId: team, teamPullId: record, recordingId: record, encounterId: 1, encounterName: "测试首领", difficultyId: 16,
  encounterStartUnixMs: 12000, encounterEndUnixMs: 22000, characterGuid: "Player-Test", characterName: "测试人物",
  status: "ready", playbackVersion: version, videoZeroMs: -300, videoDurationMs: 14000, players: [], intervals: [] });

test("媒体每一片固定版本且仅向本团队本录像发送令牌", () => {
  const api = new WebApi("unit-test-token", () => {});
  const calls = []; const xhr = { open: (...args) => calls.push(args), setRequestHeader: (...args) => calls.push(args), withCredentials: true };
  api.mediaRequest(xhr, api.mediaUrl(team, record, version).replace("index.m3u8", "segment-00001.m4s") + "&grant=ignored", team, record, version);
  assert.equal(new URL(calls[0][1]).searchParams.get("version"), version);
  assert.equal(new URL(calls[0][1]).searchParams.has("grant"), false);
  assert.equal(calls[0][1].includes("unit-test-token"), false);
  assert.deepEqual(calls[1], ["Authorization", "Bearer unit-test-token"]); assert.equal(xhr.withCredentials, false);
});

test("外域、其他录像及越界片段均在设置鉴权头之前拒绝", () => {
  const api = new WebApi("unit-test-token", () => {}); let opened = 0, headers = 0;
  const xhr = { open: () => opened++, setRequestHeader: () => headers++ };
  for (const address of ["https://unowned.invalid/index.m3u8", api.mediaUrl(team, version, version),
    api.mediaUrl(team, record, version).replace("index.m3u8", "../client-state.json")]) {
    assert.throws(() => api.mediaRequest(xhr, address, team, record, version));
  }
  assert.equal(opened, 0); assert.equal(headers, 0); api.close();
  assert.throws(() => api.mediaRequest(xhr, api.mediaUrl(team, record, version), team, record, version));
});

test("退出会话会终止未完成请求，旧响应不会返回给新页面", async () => {
  const previous = global.fetch;
  global.fetch = async (_, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))));
  try {
    const api = new WebApi("unit-test-token", () => {}), pending = api.request("/me"); api.close();
    await assert.rejects(pending, /会话已结束/);
  } finally { global.fetch = previous; }
});

test("401不回显服务正文和令牌，JSON请求不附带浏览器Cookie", async () => {
  const previous = global.fetch; let invalid = 0;
  global.fetch = async (url, options) => {
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    assert.equal(String(url).includes("unit-test-token"), false);
    return new Response(JSON.stringify({ detail: "unit-test-token" }), { status: 401 });
  };
  try {
    const api = new WebApi("unit-test-token", () => invalid++);
    await assert.rejects(api.request("/me"), (error) => error.status === 401 && !error.message.includes("unit-test-token"));
    assert.equal(invalid, 1); api.close();
  } finally { global.fetch = previous; }
});

test("目录保持服务端共同零点、负偏移和缺片，不生成本地文件或假播放URL", () => {
  const value = normalizeEntry(raw(), team);
  assert.equal(value.mapping.videoZeroMs, -300); assert.equal(value.clipStartUnixMs, 12300);
  assert.equal(value.videoPath, null); assert.equal(value.playbackUrl, null); assert.equal(value.cloudPlaybackVersion, version);
  for (const extra of [{ teamId: version }, { playbackVersion: null }, { status: "toString" }, { characterName: {} }, { players: [null] }]) {
    assert.throws(() => normalizeEntry({ ...raw(), ...extra }, team));
  }
  assert.equal(normalizeEntry({ ...raw(), hasGap: true }, team).mapping.hasGap, true);
});

test("时间点链接只含资源和共同时间，不复制原URL令牌或服务器参数", () => {
  const value = replayLink("https://user:secret@example.test/?token=secret&server=https://evil.invalid/#private", team, record, record, 3.4567);
  const url = new URL(value);
  assert.equal(url.username + url.password + url.hash, "");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["pull", "t", "team", "view"]);
  assert.equal(readReplayLink(url.search).seconds, 3.457);
  assert.equal(readReplayLink("?team=" + team.toUpperCase()).team, team);
  assert.equal(readReplayLink("?t=1e100&view=invalid&api=https://evil.invalid").seconds, 0);
});

test("未格式化Unix时间仅按中国标准时间展示一次", () => {
  assert.equal(businessDate(0), "1970-01-01"); assert.equal(businessClock(0), "08:00:00");
});
