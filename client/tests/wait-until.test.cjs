const test = require("node:test");
const assert = require("node:assert/strict");
const { waitUntil, processExited } = require("./wait-until.cjs");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

test("异步读取得到false时继续等待，只有真正满足才返回", async () => {
  let calls = 0;
  const value = await waitUntil(async () => ++calls, async (value) => value === 3, "实际保存", 1000);
  assert.equal(value, 3); assert.equal(calls, 3);
});

test("异步条件始终为false必须超时，读取失败直接暴露", async () => {
  await assert.rejects(waitUntil(async () => false, (value) => value, "从未写盘", 50), /等待超时/);
  await assert.rejects(waitUntil(async () => { throw new Error("真实错误"); }, () => true, "读取"), /真实错误/);
});

test("真实子进程被信号结束时不再把null退出码当作仍运行", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true });
  await once(child, "spawn");
  assert.equal(processExited(child), false);
  const exited = once(child, "exit");
  child.kill("SIGTERM"); await exited;
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, "SIGTERM");
  assert.equal(processExited(child), true);
});

test("真实子进程正常退出仍按退出码完成", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true });
  await once(child, "exit");
  assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
  assert.equal(processExited(child), true);
});
