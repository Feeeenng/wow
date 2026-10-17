const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TestCloudStack } = require("./real-stack.cjs");
const { startSite } = require("./site-server.cjs");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(arg("--output")), playwright = require(path.resolve(arg("--playwright")));
const stack = new TestCloudStack({ python: path.resolve(arg("--python")), privateFile: path.resolve(arg("--private")), fixture: path.resolve(arg("--fixture")), output: path.join(output, "services") });
const report = { cases: [], pageErrors: [], boundary: "真实 PG 偏好表／迁移、HTTP API、私有媒体、WCL 协议服务和独立浏览器；只延迟转发，不替换 API 响应；未使用实战媒体或正式库" };
const requests = [];
let browser, site, page, gate;
fs.mkdirSync(output, { recursive: true });
const run = async (name, check) => { await check(); report.cases.push({ name, passed: true }); console.log("PASS " + name); };
const login = async (target, token) => {
  await target.getByLabel("访问令牌", { exact: true }).fill(token);
  await target.getByRole("button", { name: "验证并进入", exact: true }).click();
  await target.getByRole("button", { name: "退出", exact: true }).waitFor();
};
const panel = async (target = page) => {
  const content = target.locator(".personal-layout-settings");
  if (!await content.isVisible()) await target.getByRole("button", { name: "轨道布局", exact: true }).click();
  await content.waitFor({ state: "visible" });
};
const close = async (target = page) => {
  const content = target.locator(".personal-layout-settings");
  if (await content.isVisible()) await target.getByText("战斗时间轴", { exact: true }).click();
  await content.waitFor({ state: "hidden" });
};
const add = async (name, target = page) => {
  await target.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill(name);
  await target.getByRole("button", { name: "新增个人轨道", exact: true }).click();
};
const save = async (target = page) => {
  const response = target.waitForResponse((item) => item.request().method() === "PUT" && item.url().endsWith("/preferences/replay"));
  // 验证真实键盘提交入口；加载前后均使用按钮稳定的可访问名称。
  const submit = async () => {
    const button = target.getByRole("button", { name: "保存个人布局", exact: true });
    await button.focus(); await button.press("Enter");
  };
  const [, result] = await Promise.all([submit(), response]);
  return result.status();
};
const choose = async (target, picker, label) => {
  await picker.click(); await target.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content").getByText(label, { exact: true }).click();
};
const playable = (target = page) => target.waitForFunction(() => { const video = document.querySelector("video"); return video?.readyState >= 2 && !video.seeking; });
const track = (name, target = page) => target.getByRole("slider", { name: "跳转到" + name + "时间", exact: true });
const block = (method, team) => {
  let release, entered;
  const done = new Promise((resolve) => { release = resolve; }), seen = new Promise((resolve) => { entered = resolve; });
  gate = { method, team, done, entered, release };
  return { seen, release: () => { gate = null; release(); } };
};

async function main() {
  try {
    const info = await stack.start(), seeded = await stack.seed();
    const recording = seeded.records.find((item) => item.characterName === "网页视角甲");
    const prefs = "/teams/" + info.teamId + "/preferences/replay";
    const originalEvents = JSON.stringify(await stack.request("/teams/" + info.teamId + "/recordings/" + recording.recordingId + "/events?limit=1000"));
    const second = await stack.command("secondTeam"); stack.info = { ...info, teamId: second.teamId, teamPullId: second.teamPullId };
    await stack.seed({ importWcl: false, deviceId: "preferences-second" }); stack.info = info;
    const primaryName = (await stack.request("/me")).teams.find((item) => item.teamId === info.teamId).name;
    site = await startSite(info.endpoint, requests, async (item) => {
      const value = gate;
      if (value && item.method === value.method && item.path === "/api/v1/teams/" + value.team + "/preferences/replay") { value.entered(); await value.done; }
    });
    browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage();
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    const address = site.origin + "?team=" + info.teamId + "&pull=" + info.teamPullId + "&view=" + recording.recordingId + "&t=3";
    await page.goto(address); await login(page, info.token); await playable(); await page.getByText("已读取 7 条", { exact: true }).waitFor();
    await run("显式保存真实拖轨及外观，刷新后重新登录从服务器恢复，播放器不中断", async () => {
      await panel(); await page.getByText("个人布局已与服务器同步。", { exact: true }).waitFor(); await add("😀".repeat(32)); await close();
      const destination = track("😀".repeat(32));
      await page.getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).dragTo(destination);
      await page.getByRole("button", { name: "设置时间轴外观", exact: true }).click();
      const height = page.getByRole("spinbutton", { name: "时间轴轨道高度", exact: true }); await height.fill("45"); await height.press("Tab"); await close();
      await page.getByRole("button", { name: "放大", exact: true }).click();
      const video = page.getByLabel("团队回放", { exact: true }); await video.evaluate((element) => { element.dataset.preferenceCheck = "same-instance"; });
      const before = await video.evaluate((element) => element.currentTime); await panel(); assert.equal(await save(), 200);
      await page.getByText("个人布局已与服务器同步。", { exact: true }).waitFor();
      assert.equal(await video.evaluate((element) => element.dataset.preferenceCheck), "same-instance");
      assert.ok(Math.abs(await video.evaluate((element) => element.currentTime) - before) < .06); await close();
      const stored = await stack.request(prefs); assert.equal(stored.version, 1); assert.equal(stored.document.timelineTrackHeight, 45); assert.equal(stored.document.timelineZoom, 1.5);
      assert.equal(Object.keys(stored.document.timelineTrackOverrides).length, 1);
      await page.reload(); await login(page, info.token); await playable(); await destination.waitFor();
      await page.waitForFunction(() => document.querySelector(".track-canvas")?.getBoundingClientRect().height === 45);
      const customId = stored.document.customTimelineTracks[0].id;
      await page.locator('[data-replay-track="' + customId + '"]').getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
      assert.equal(JSON.stringify(await stack.request("/teams/" + info.teamId + "/recordings/" + recording.recordingId + "/events?limit=1000")), originalEvents);
      await page.screenshot({ path: path.join(output, "preferences-restored-1440.png"), fullPage: true });
    });
    await run("两个独立浏览器冲突保留草稿，取消重新读取不覆盖，确认后读取胜者", async () => {
      const otherContext = await browser.newContext(), other = await otherContext.newPage();
      try {
        other.on("pageerror", (error) => report.pageErrors.push(error.message)); await other.goto(address); await login(other, info.token); await playable(other);
        await panel(other); await other.getByText("个人布局已与服务器同步。", { exact: true }).waitFor();
        await panel(); await add("本页未保存草稿"); await add("另一个浏览器保存", other); assert.equal(await save(other), 200);
        assert.equal(await save(), 409); await page.getByText("个人布局已在其他页面修改，当前草稿已保留。请读取最新布局后复核。", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "保存个人布局", exact: true }).isDisabled(), true); await track("本页未保存草稿").waitFor();
        await page.getByRole("button", { name: "读取最新布局", exact: true }).click(); await page.getByRole("button", { name: "保留草稿", exact: true }).click(); await track("本页未保存草稿").waitFor();
        await page.getByRole("button", { name: "读取最新布局", exact: true }).click(); await page.getByRole("button", { name: "替换草稿", exact: true }).click();
        await page.getByText("个人布局已与服务器同步。", { exact: true }).waitFor(); assert.equal(await track("本页未保存草稿").count(), 0); await track("另一个浏览器保存").waitFor(); await close();
      } finally { await otherContext.close(); }
    });
    await run("保存途中继续编辑不会被较早回包抹掉，只有提交时的快照落盘", async () => {
      await panel(); await add("提交中的轨道"); const held = block("PUT", info.teamId);
      const response = page.waitForResponse((item) => item.request().method() === "PUT" && item.url().endsWith("/preferences/replay"));
      await page.getByRole("button", { name: "保存个人布局", exact: true }).click(); await held.seen;
      await add("保存途中编辑"); held.release(); assert.equal((await response).status(), 200);
      await page.getByText("个人布局有未保存的修改。", { exact: true }).waitFor(); await track("保存途中编辑").waitFor();
      const stored = await stack.request(prefs); assert.ok(stored.document.customTimelineTracks.some((item) => item.name === "提交中的轨道"));
      assert.equal(stored.document.customTimelineTracks.some((item) => item.name === "保存途中编辑"), false);
      assert.equal(await save(), 200); await page.getByText("个人布局已与服务器同步。", { exact: true }).waitFor(); await close();
    });
    await run("确认重新读取后继续编辑，迟到快照只更新版本而不抹掉新草稿", async () => {
      await panel(); await add("重新读取前草稿"); const held = block("GET", info.teamId);
      await page.getByRole("button", { name: "读取最新布局", exact: true }).click(); await page.getByRole("button", { name: "替换草稿", exact: true }).click(); await held.seen;
      await add("读取过程中编辑"); held.release();
      await page.getByText("个人布局有未保存的修改。", { exact: true }).waitFor(); await track("读取过程中编辑").waitFor();
      // 删除测试新增项，不影响后续最多八轨的边界场景。
      await page.getByRole("button", { name: "删除重新读取前草稿轨道", exact: true }).click();
      await page.getByRole("button", { name: "删除读取过程中编辑轨道", exact: true }).click(); await close();
    });
    await run("真实数据库失败不标记已保存，初读失败禁止写入默认值，恢复后保留草稿", async () => {
      await panel(); await add("数据库失败草稿"); await stack.command("preferencesUnavailable");
      assert.equal(await save(), 503); await page.getByText("复盘服务暂不可用，请稍后重试。", { exact: true }).waitFor(); await track("数据库失败草稿").waitFor();
      const otherContext = await browser.newContext(), other = await otherContext.newPage();
      try {
        other.on("pageerror", (error) => report.pageErrors.push(error.message)); await other.goto(address); await login(other, info.token); await playable(other); await panel(other);
        await other.getByText("复盘服务暂不可用，请稍后重试。", { exact: true }).waitFor(); await add("初读失败后编辑", other);
        assert.equal(await other.getByRole("button", { name: "保存个人布局", exact: true }).isDisabled(), true);
        await stack.command("preferencesRestore");
        // 切团队再返回触发未加载文档的首次读取重试；新读快照不能覆盖先前编辑。
        await close(other); await choose(other, other.getByRole("combobox", { name: "选择团队", exact: true }), second.name); await track("敌方技能", other).waitFor();
        await choose(other, other.getByRole("combobox", { name: "选择团队", exact: true }), primaryName); await track("初读失败后编辑", other).waitFor();
        await panel(other); await other.getByText("个人布局有未保存的修改。", { exact: true }).waitFor();
      } finally { await otherContext.close(); }
      // 关闭独立窗口后显式恢复主窗口焦点，检查失败草稿仍可提交。
      await page.bringToFront();
      await panel();
      await page.screenshot({ path: path.join(output, "database-restored-before-save.png"), fullPage: true });
      assert.equal(await page.getByRole("button", { name: "保存个人布局", exact: true }).isEnabled(), true);
      assert.equal(await save(), 200); await page.getByText("个人布局已与服务器同步。", { exact: true }).waitFor(); await close();
    });
    await run("迟到读取按团队归属返回，普通成员仅保存本人布局，跨设备恢复", async () => {
      const held = block("GET", second.teamId);
      await choose(page, page.getByRole("combobox", { name: "选择团队", exact: true }), second.name); await held.seen;
      await choose(page, page.getByRole("combobox", { name: "选择团队", exact: true }), primaryName); held.release(); await track("数据库失败草稿").waitFor();
      const memberContext = await browser.newContext(), member = await memberContext.newPage();
      try {
        member.on("pageerror", (error) => report.pageErrors.push(error.message)); await member.goto(address); await login(member, info.observerToken); await playable(member);
        assert.equal(await member.locator('[data-replay-track^="custom-"]').count(), 0); await panel(member); await add("团员私人轨道", member); assert.equal(await save(member), 200);
        await member.reload(); await login(member, info.observerToken); await playable(member); await track("团员私人轨道", member).waitFor();
        assert.equal(await track("团员私人轨道").count(), 0);
        assert.equal((await stack.request(prefs, "GET", undefined, info.observerToken)).document.customTimelineTracks[0].name, "团员私人轨道");
      } finally { await memberContext.close(); }
      const stored = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
      assert.deepEqual(stored, { local: [], session: [] }); report.storageKeys = stored;
      await page.setViewportSize({ width: 390, height: 844 }); await panel();
      await page.waitForFunction(() => {
        const content = document.querySelector(".ant-popover:not(.ant-popover-hidden) .personal-layout-settings");
        return content && getComputedStyle(content.closest(".ant-popover")).opacity === "1";
      });
      const box = await page.locator(".ant-popover:not(.ant-popover-hidden) .personal-layout-settings").boundingBox();
      assert.ok(box.width <= 390 && box.x >= 0 && box.x + box.width <= 390);
      await page.screenshot({ path: path.join(output, "preferences-390.png"), fullPage: true, animations: "disabled" }); await close();
    });
    await run("保存等待时退出账号，迟到回包不污染新账号，撤权后读取与保存都被拒绝", async () => {
      await page.setViewportSize({ width: 1440, height: 900 }); await panel(); await add("退出前等待保存"); const held = block("PUT", info.teamId);
      await page.getByRole("button", { name: "保存个人布局", exact: true }).click(); await held.seen;
      await page.getByRole("button", { name: "退出", exact: true }).click(); await login(page, info.observerToken); held.release(); await playable(); await track("团员私人轨道").waitFor();
      assert.equal(await track("退出前等待保存").count(), 0);
      await page.getByRole("button", { name: "退出", exact: true }).click(); await login(page, info.token); await playable(); await panel(); await add("撤权后不能保存");
      await stack.command("revoke"); assert.equal(await save(), 403); await track("撤权后不能保存").waitFor();
      const response = page.waitForResponse((item) => item.request().method() === "GET" && item.url().endsWith("/preferences/replay"));
      await page.getByRole("button", { name: "读取最新布局", exact: true }).click(); await page.getByRole("button", { name: "替换草稿", exact: true }).click(); assert.equal((await response).status(), 403);
      await track("撤权后不能保存").waitFor();
    });
    assert.deepEqual(report.pageErrors, []); report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = String(error.stack || error);
    if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    gate?.release(); gate = null;
    if (browser) await browser.close(); if (site) await site.close();
    report.cleanup = await stack.close(); fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
