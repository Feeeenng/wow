/** 等待真实异步读取满足条件；不把Promise对象本身当作已满足，超时必须失败。 */
exports.waitUntil = async (read, accept, label, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await read();
    if (await accept(value)) return value;
    if (Date.now() >= deadline) throw new Error("等待超时：" + label);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** Node被信号结束时exitCode仍为null，signalCode有值同样表示已退出。 */
exports.processExited = (child) => child.exitCode !== null || child.signalCode !== null;
