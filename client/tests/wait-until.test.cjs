const test = require("node:test");
const assert = require("node:assert/strict");
const { waitUntil } = require("./wait-until.cjs");

test("异步读取得到false时继续等待，只有真正满足才返回", async () => {
  let calls = 0;
  const value = await waitUntil(async () => ++calls, async (value) => value === 3, "实际保存", 1000);
  assert.equal(value, 3); assert.equal(calls, 3);
});

test("异步条件始终为false必须超时，读取失败直接暴露", async () => {
  await assert.rejects(waitUntil(async () => false, (value) => value, "从未写盘", 50), /等待超时/);
  await assert.rejects(waitUntil(async () => { throw new Error("真实错误"); }, () => true, "读取"), /真实错误/);
});
