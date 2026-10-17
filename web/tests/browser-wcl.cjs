const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TestCloudStack } = require("./real-stack.cjs");
const { startSite } = require("./site-server.cjs");

const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output")), playwright = require(path.resolve(argument("--playwright")));
const options = { python: path.resolve(argument("--python")), privateFile: path.resolve(argument("--private")), fixture: path.resolve(argument("--fixture")) };
const report = { cases: [], pageErrors: [], boundary: "独立Web真实HTTP／PG／私有MinIO／Redis／独立worker；固定合成媒体与WCL协议，不访问线上报告" };
let browser, stack, site, page; let requests = [];
fs.mkdirSync(output, { recursive: true });
const run = async (name, test) => { await test(); report.cases.push({ name, passed: true }); console.log("PASS " + name); };
const login = async (target, token) => {
  await target.getByLabel("访问令牌", { exact: true }).fill(token); await target.getByRole("button", { name: "验证并进入", exact: true }).click();
  await target.getByRole("button", { name: "退出", exact: true }).waitFor();
};
const video = () => page.getByLabel("团队回放", { exact: true });
const open = async () => {
  await page.getByRole("button", { name: "标准事件", exact: true }).click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.ant-drawer-open [role="dialog"]'); if (!dialog) return false;
    const box = dialog.getBoundingClientRect(); return box.left >= 0 && Math.abs(box.right - innerWidth) < 1 && box.width >= Math.min(300, innerWidth);
  });
};
const close = async () => {
  const dialog = page.getByRole("dialog", { name: "关联标准战斗事件" }), element = await dialog.elementHandle();
  await dialog.getByRole("button", { name: /close|关闭/i }).click(); await element.waitForElementState("hidden"); await element.dispose();
};
const ready = () => page.getByText("标准事件已就绪", { exact: true }).waitFor({ timeout: 30000 });
const refreshButton = () => page.getByRole("button", { name: "重新导入并应用人物绑定", exact: true });
const posts = () => requests.filter((item) => item.method === "POST" && item.path.endsWith("/wcl/imports"));
async function start(withWcl) {
  requests = []; stack = new TestCloudStack({ ...options, output: path.join(output, withWcl ? "configured" : "unconfigured"), withWcl });
  const info = await stack.start(), seeded = await stack.seed({ importWcl: false }); site = await startSite(info.endpoint, requests);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message)); await page.goto(site.origin); await login(page, info.token);
  await page.getByRole("button", { name: "观看网页视角甲视角", exact: true }).click();
  await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.readyState >= 2 && !v.seeking; });
  return { info, seeded, context };
}
async function stop() {
  if (site) { await site.close(); site = null; }
  if (stack) { const cleanup = await stack.close(); (report.cleanups ??= []).push(cleanup); stack = null; }
}
async function main() {
  try {
    browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
    const { info, seeded, context } = await start(true);
    const a = seeded.records.find((item) => item.characterName === "网页视角甲"), b = seeded.records.find((item) => item.characterName === "网页视角乙");
    const statusRoute = "/teams/" + info.teamId + "/pulls/" + info.teamPullId + "/wcl";
    await run("初次未绑定显示待导入、非法链接禁用且输入不触发全屏", async () => {
      await page.getByText("标准战斗事件尚未就绪，可先浏览录像。", { exact: true }).waitFor(); await open();
      await page.getByText("尚未关联报告", { exact: true }).waitFor();
      const submit = page.getByRole("button", { name: "导入标准事件", exact: true }); assert.equal(await submit.isDisabled(), true);
      const reference = page.getByRole("textbox", { name: "WCL 报告链接或代码", exact: true });
      await reference.fill("https://warcraftlogs.com.unowned.invalid/reports/AbCdEfGh12345678#fight=1");
      await page.getByText("请输入 16 位报告代码或官方 HTTPS 报告链接。", { exact: true }).waitFor(); assert.equal(await submit.isDisabled(), true);
      await reference.press("t"); assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
      assert.equal(posts().length, 0);
      await reference.fill("https://cn.warcraftlogs.com/reports/" + info.wclReportCode + "#fight=1&type=casts");
      assert.equal(await page.getByRole("spinbutton", { name: "战斗编号 fight", exact: true }).inputValue(), "1");
      await reference.fill("ZbCdEfGh12345678"); assert.equal(await page.getByRole("spinbutton", { name: "战斗编号 fight", exact: true }).inputValue(), "");
      assert.equal(await submit.isDisabled(), true);
      await close(); await open(); assert.equal(await reference.inputValue(), "ZbCdEfGh12345678");
      await reference.fill("https://cn.warcraftlogs.com/reports/" + info.wclReportCode + "#fight=1");
    });
    await run("界面首次导入经真实worker发布完整事件，持续播放不被重建", async () => {
      await video().evaluate((v) => { v.dataset.validationInstance = "first"; v.muted = true; return v.play(); });
      const before = await video().evaluate((v) => v.currentTime), mediaBefore = requests.filter((item) => item.path.endsWith("/media/index.m3u8")).length;
      await page.getByRole("button", { name: "导入标准事件", exact: true }).click(); await ready();
      await page.getByText("已发布 7 个关键事件", { exact: true }).waitFor();
      const status = await stack.request(statusRoute); assert.equal(status.actorBindings.length, 0); assert.equal(status.eventCount, 7);
      assert.deepEqual(await video().evaluate((v) => [v.dataset.validationInstance, v.paused]), ["first", false]);
      assert.ok(await video().evaluate((v) => v.currentTime) > before);
      assert.equal(requests.filter((item) => item.path.endsWith("/media/index.m3u8")).length, mediaBefore); assert.equal(posts().length, 1);
      await video().evaluate((v, seconds) => { v.pause(); v.currentTime = seconds; }, a.videoZeroMs / 1000 + 3);
      await close(); await page.getByText("已读取 7 条", { exact: true }).waitFor();
      assert.equal(await page.locator('.track-row').filter({ has: page.getByText("个人技能", { exact: true }) }).locator('button.event-marker').count(), 0);
    });
    await run("同名WCL人物按actor编号明确绑定，不猜本人角色", async () => {
      await open(); await ready();
      for (const [name, actor] of [["网页视角甲", 1], ["网页视角乙", 2]]) {
        await page.getByRole("combobox", { name: "WCL人物绑定" + name, exact: true }).click();
        const popup = await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").elementHandle();
        await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByText("同名标准角色 · Hunter · #" + actor, { exact: true }).click();
        await popup.waitForElementState("hidden"); await popup.dispose();
      }
      const previousRevision = (await stack.request(statusRoute)).revision;
      await refreshButton().click();
      const deadline = Date.now() + 30000;
      while (true) {
        const current = await stack.request(statusRoute);
        if (current.status === "ready" && current.revision !== previousRevision) break;
        assert.ok(Date.now() < deadline); await page.waitForTimeout(100);
      }
      await ready();
      const status = await stack.request(statusRoute);
      assert.deepEqual(status.actorBindings.map((item) => [item.recordingId, item.actorId]).sort(), [[a.recordingId, 1], [b.recordingId, 2]].sort());
      await close(); await page.getByText("已读取 7 条", { exact: true }).waitFor();
      await page.locator('.track-row').filter({ has: page.getByText("个人技能", { exact: true }) })
        .getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
    });
    await run("关闭面板后真实导入继续，旧快照与播放器保持，重新打开读取新版本", async () => {
      const before = await stack.request(statusRoute); await stack.command("webWclHold"); await open(); await ready();
      const mediaBefore = requests.filter((item) => item.path.endsWith("/media/index.m3u8")).length;
      await refreshButton().click(); await page.getByText(/等待导入|正在导入/, { exact: true }).waitFor();
      assert.equal((await stack.request(statusRoute)).revision, before.revision); await close();
      await page.getByText("已读取 7 条", { exact: true }).waitFor(); assert.equal(await video().evaluate((v) => v.dataset.validationInstance), "first");
      const statusGets = requests.filter((item) => item.path.endsWith("/wcl")).length;
      await page.waitForTimeout(2300); assert.equal(requests.filter((item) => item.path.endsWith("/wcl")).length, statusGets);
      await stack.command("webWclResume");
      const deadline = Date.now() + 30000;
      while (true) {
        const current = await stack.request(statusRoute); if (current.status === "ready") break;
        assert.notEqual(current.status, "failed", "上游恢复后的导入任务失败"); assert.ok(Date.now() < deadline); await page.waitForTimeout(100);
      }
      await open(); await ready();
      assert.notEqual((await stack.request(statusRoute)).revision, before.revision);
      assert.equal(await video().evaluate((v) => v.dataset.validationInstance), "first");
      assert.equal(requests.filter((item) => item.path.endsWith("/media/index.m3u8")).length, mediaBefore); await close();
    });
    await run("真实分页故障明确失败保旧，界面重试后发布完整新快照", async () => {
      const before = await stack.request(statusRoute); await stack.command("wclFail"); await open(); await ready();
      await refreshButton().click(); await page.getByText("导入失败", { exact: true }).waitFor({ timeout: 30000 });
      await page.getByText("本次报告导入未完成", { exact: true }).waitFor();
      const failed = await stack.request(statusRoute); assert.equal(failed.revision, before.revision); assert.equal(failed.eventCount, 7);
      await close(); await page.getByText("已读取 7 条", { exact: true }).waitFor();
      await stack.command("wclRevision"); await open(); await refreshButton().click(); await ready();
      assert.notEqual((await stack.request(statusRoute)).revision, before.revision); await close();
    });
    await run("当前团队只读成员禁止导入，API也拒绝而录像可看", async () => {
      const guest = await context.newPage(); guest.on("pageerror", (error) => report.pageErrors.push(error.message));
      try {
        await guest.goto(site.origin); await login(guest, info.observerToken); await guest.getByRole("button", { name: "标准事件", exact: true }).click();
        await guest.getByText("当前账号仅可查看，导入需要团长或分析员权限。", { exact: true }).waitFor();
        assert.equal(await guest.getByRole("button", { name: "重新导入并应用人物绑定", exact: true }).isDisabled(), true);
        const response = await fetch(info.endpoint + "/api/v1" + statusRoute + "/imports", { method: "POST", headers: { Authorization: "Bearer " + info.observerToken, "Content-Type": "application/json" },
          body: JSON.stringify({ reportCode: info.wclReportCode, fightId: 1, actorBindings: [] }) }); assert.equal(response.status, 403);
        await guest.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
      } finally { await guest.close(); }
    });
    await run("全屏及手机报告面板无溢出，关闭后返回当前战斗点", async () => {
      await page.getByRole("button", { name: "切换复盘全屏", exact: true }).click(); await open(); await ready();
      assert.equal(await page.getByRole("dialog", { name: "关联标准战斗事件" }).evaluate((element) => !!element.closest(":fullscreen")), true);
      await page.screenshot({ path: path.join(output, "wcl-fullscreen.png"), fullPage: true }); await close(); await page.keyboard.press("t");
      await page.waitForFunction(() => !document.fullscreenElement);
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width, height }); await open(); await ready();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator('.replay-main').evaluate((element) => element.scrollLeft), 0);
        await page.screenshot({ path: path.join(output, "wcl-" + width + ".png"), fullPage: true }); await close();
      }
      report.inspection = await stack.command("inspect");
    });
    await context.close(); await stop();
    const missing = await start(false);
    await run("实际未配置WCL凭证时禁用导入，已就绪媒体仍可播放", async () => {
      await open(); await page.getByText("服务器尚未配置 WCL 应用凭证", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "WCL 报告链接或代码", exact: true }).fill("https://cn.warcraftlogs.com/reports/AbCdEfGh12345678#fight=1");
      assert.equal(await page.getByRole("button", { name: "导入标准事件", exact: true }).isDisabled(), true); assert.equal(posts().length, 0);
      await close(); assert.ok(await video().evaluate((v) => v.readyState >= 2));
    });
    await missing.context.close(); assert.deepEqual(report.pageErrors, []); report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = String(error.stack || error);
    if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close(); await stop();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
