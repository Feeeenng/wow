const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TestCloudStack } = require("./real-stack.cjs");
const { startSite } = require("./site-server.cjs");
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output")), playwright = require(path.resolve(argument("--playwright")));
const stack = new TestCloudStack({ python: path.resolve(argument("--python")), privateFile: path.resolve(argument("--private")), fixture: path.resolve(argument("--fixture")), output: path.join(output, "services") });
const report = { cases: [], pageErrors: [], boundary: "Web真实API／PG／私有MinIO／Redis／独立worker和合成媒体；本组不点保存，验证未保存草稿及轨道交互，持久化另见 browser-preferences" };
let browser, page, site; const requests = [];
fs.mkdirSync(output, { recursive: true });
const run = async (name, test) => { await test(); report.cases.push({ name, passed: true }); console.log("PASS " + name); };
const video = () => page.getByLabel("团队回放", { exact: true });
const closePanel = async () => { await page.getByText("战斗时间轴", { exact: true }).click(); };
const settings = () => page.getByRole("button", { name: "轨道布局", exact: true }).click();
const seeked = (target) => page.waitForFunction((seconds) => { const v = document.querySelector("video"); return v?.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - seconds) < .06; }, target);
const login = async (target, token) => {
  await target.getByLabel("访问令牌", { exact: true }).fill(token); await target.getByRole("button", { name: "验证并进入", exact: true }).click(); await target.getByRole("button", { name: "退出", exact: true }).waitFor();
};
const selectOption = async (picker, label) => {
  await picker.click(); const popup = await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").elementHandle();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content").getByText(label, { exact: true }).click();
  await popup.waitForElementState("hidden"); await popup.dispose();
};
const track = (id) => page.locator('[data-replay-track="' + id + '"]');
const saint = () => page.getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true });
async function main() {
  try {
    const info = await stack.start(), seeded = await stack.seed();
    const a = seeded.records.find((item) => item.characterName === "网页视角甲"), b = seeded.records.find((item) => item.characterName === "网页视角乙");
    const second = await stack.command("secondTeam"); stack.info = { ...info, teamId: second.teamId, teamPullId: second.teamPullId };
    await stack.seed({ importWcl: false, deviceId: "second-team-layout-test" }); stack.info = info;
    const primaryName = (await stack.request("/me")).teams.find((item) => item.teamId === info.teamId).name;
    site = await startSite(info.endpoint, requests);
    browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage();
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    const address = site.origin + "?team=" + info.teamId + "&pull=" + info.teamPullId + "&view=" + a.recordingId + "&t=3";
    await page.goto(address); await login(page, info.token); await seeked(a.videoZeroMs / 1000 + 3);
    await page.getByText("已读取 7 条", { exact: true }).waitFor();
    const eventsRoute = "/teams/" + info.teamId + "/recordings/" + a.recordingId + "/events?limit=1000";
    const beforeEvents = (await stack.request(eventsRoute)).events, beforeJson = JSON.stringify(beforeEvents);
    const teamEvent = beforeEvents.find((item) => item.owner === "team" && item.kind === "castSuccess" && item.spellId === 17 && item.pullTimeMs > 0);
    let custom;
    await run("个人轨道名称校验、新增稳定UUID及真实拖入，原事件和媒体不变", async () => {
      await settings(); const name = page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }), add = page.getByRole("button", { name: "新增个人轨道", exact: true });
      assert.equal(await add.isDisabled(), true); await name.fill(" "); assert.equal(await add.isDisabled(), true);
      await name.fill("😀".repeat(32)); await add.click();
      await page.getByRole("textbox", { name: "轨道名称 " + "😀".repeat(32), exact: true }).waitFor();
      await name.fill("😀".repeat(32)); await add.click(); await page.getByText("已存在同名个人轨道，请使用其他名称。", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "轨道名称 " + "😀".repeat(32), exact: true }).fill("关键时刻");
      await page.getByRole("button", { name: "保存" + "😀".repeat(32) + "轨道名称", exact: true }).click(); await closePanel();
      const target = page.getByRole("slider", { name: "跳转到关键时刻时间", exact: true }); custom = await target.locator("../..").getAttribute("data-replay-track");
      assert.match(custom, /^custom-[0-9a-f-]{36}$/);
      await video().evaluate((v) => { v.dataset.validationInstance = "tracks"; });
      const time = await video().evaluate((v) => v.currentTime); await saint().dragTo(target); await track(custom).getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
      assert.equal(await video().evaluate((v) => v.dataset.validationInstance), "tracks"); await seeked(time);
      assert.equal(JSON.stringify((await stack.request(eventsRoute)).events), beforeJson);
      await track(custom).getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).click(); await seeked(a.videoZeroMs / 1000 + 3); await closePanel();
      await page.screenshot({ path: path.join(output, "tracks-custom-1440.png"), fullPage: true, animations: "disabled" });
    });
    await run("同组来源规则跨视角不混用，刷新视角元数据后布局仍保留", async () => {
      await page.getByRole("button", { name: "观看网页视角乙视角", exact: true }).click(); await seeked(b.videoZeroMs / 1000 + 3);
      assert.equal(await track(custom).locator("button.event-marker").count(), 0); await track("team").getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
      await page.getByRole("button", { name: "观看网页视角甲视角", exact: true }).click(); await seeked(a.videoZeroMs / 1000 + 3);
      await track(custom).getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
      await page.getByRole("button", { name: "刷新团队录像", exact: true }).click(); await seeked(a.videoZeroMs / 1000 + 3);
      await track(custom).getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
    });
    await run("详情移轨可用于键盘或触屏，混合规则分组不冒充单技能拖动", async () => {
      const other = track("team").getByRole("button", { name: "标准真言盾 施法成功 0:06", exact: true }); await other.click(); await seeked(a.videoZeroMs / 1000 + 3.5); await closePanel();
      await other.hover(); const picker = page.getByRole("combobox", { name: "移动技能 " + teamEvent.eventId + " 到轨道", exact: true });
      await selectOption(picker, "关键时刻"); await closePanel();
      await page.setViewportSize({ width: 390, height: 844 });
      const group = track(custom).locator("button.event-marker");
      await page.waitForFunction((id) => document.querySelectorAll('[data-replay-track="' + id + '"] button.event-marker').length === 1, custom);
      assert.equal(await group.count(), 1); assert.match(await group.getAttribute("aria-label"), /等 2 个事件/); assert.equal(await group.getAttribute("draggable"), "false");
      await page.screenshot({ path: path.join(output, "tracks-custom-390.png"), fullPage: true, animations: "disabled" });
      const before = await video().evaluate((v) => v.currentTime); await group.click();
      await selectOption(page.getByRole("combobox", { name: "移动技能 " + teamEvent.eventId + " 到轨道", exact: true }), "团队技能");
      await closePanel(); await seeked(before); assert.equal(JSON.stringify((await stack.request(eventsRoute)).events), beforeJson);
      await page.setViewportSize({ width: 1440, height: 900 });
    });
    await run("个人布局按团队与账号隔离，切团队后恢复本人的显示规则", async () => {
      const teams = page.getByRole("combobox", { name: "选择团队", exact: true }); await selectOption(teams, second.name);
      await page.getByRole("slider", { name: "跳转到敌方技能时间", exact: true }).waitFor(); assert.equal(await track(custom).count(), 0);
      await settings(); await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill("第二团队布局");
      await page.getByRole("button", { name: "新增个人轨道", exact: true }).click(); await closePanel();
      await selectOption(teams, primaryName); await track(custom).waitFor(); assert.equal(await page.getByRole("slider", { name: "跳转到第二团队布局时间", exact: true }).count(), 0);
      const guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }), guest = await guestContext.newPage();
      try {
        guest.on("pageerror", (error) => report.pageErrors.push(error.message)); await guest.goto(address); await login(guest, info.observerToken);
        await guest.getByText("已读取 7 条", { exact: true }).waitFor(); assert.equal(await guest.locator('[data-replay-track="' + custom + '"]').count(), 0);
        await guest.getByRole("button", { name: "轨道布局", exact: true }).click();
        await guest.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill("成员自己的布局"); await guest.getByRole("button", { name: "新增个人轨道", exact: true }).click();
        assert.equal(await page.getByRole("slider", { name: "跳转到成员自己的布局时间", exact: true }).count(), 0);
      } finally { await guestContext.close(); }
    });
    await run("外观与缩放调整影响显示，清除覆盖和删除轨道恢复默认分类", async () => {
      await page.getByRole("button", { name: "设置时间轴外观", exact: true }).click();
      const height = page.getByRole("spinbutton", { name: "时间轴轨道高度", exact: true }); await height.fill("50"); await height.press("Tab");
      const icon = page.locator("#web-icon-percent [role='slider']"); await icon.focus(); await icon.press("End"); await closePanel();
      await page.getByRole("button", { name: "放大", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.track-canvas').getBoundingClientRect().height === 50);
      assert.equal(await saint().evaluate((element) => element.getBoundingClientRect().width), 50);
      assert.equal(await page.locator('.axis-scroll').evaluate((element) => element.scrollWidth > element.clientWidth), true);
      await settings(); await page.getByRole("button", { name: "清除关键时刻轨道覆盖", exact: true }).click(); await closePanel();
      await track("player").getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).waitFor();
      await settings(); await page.getByRole("button", { name: "删除关键时刻轨道", exact: true }).click(); await closePanel(); assert.equal(await track(custom).count(), 0);
      await page.getByRole("button", { name: "设置时间轴外观", exact: true }).click(); await page.getByRole("button", { name: "恢复默认外观", exact: true }).click(); await closePanel();
    });
    await run("新增数量有界、恢复默认及退出清空，不偷偷提交团队写入", async () => {
      await settings();
      for (let index = 0; index < 8; index++) { await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill("轨道" + index); await page.getByRole("button", { name: "新增个人轨道", exact: true }).click(); }
      await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill("第九条"); assert.equal(await page.getByRole("button", { name: "新增个人轨道", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "恢复默认轨道布局", exact: true }).click(); await closePanel();
      assert.equal(await page.locator('[data-replay-track^="custom-"]').count(), 0);
      assert.equal(requests.some((item) => ["POST", "PUT", "PATCH", "DELETE"].includes(item.method)), false);
      await settings(); await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill("退出清理验证"); await page.getByRole("button", { name: "新增个人轨道", exact: true }).click(); await closePanel();
      await page.getByRole("button", { name: "退出", exact: true }).click(); await login(page, info.token);
      await page.getByRole("slider", { name: "跳转到敌方技能时间", exact: true }).waitFor(); assert.equal(await page.locator('[data-replay-track^="custom-"]').count(), 0);
      const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
      report.storageKeys = { local: Object.keys(stored.local), session: Object.keys(stored.session) };
      const content = JSON.stringify(stored); assert.equal(content.includes("退出清理验证"), false); assert.equal(content.includes("custom-"), false);
      assert.equal(content.includes(info.token), false); assert.equal(content.includes(info.observerToken), false);
      assert.deepEqual(report.storageKeys, { local: [], session: [] });
    });
    await run("1057真实事件分组详情按20项分页，后续页事件仍按原时刻回看", async () => {
      await stack.command("webBulkEvents");
      await stack.request("/teams/" + info.teamId + "/pulls/" + info.teamPullId + "/wcl/imports", "POST", { reportCode: info.wclReportCode, fightId: 1, refresh: true,
        actorBindings: [{ recordingId: a.recordingId, actorId: 1 }, { recordingId: b.recordingId, actorId: 2 }] });
      const deadline = Date.now() + 60000;
      while (true) {
        const state = await stack.request("/teams/" + info.teamId + "/pulls/" + info.teamPullId + "/wcl");
        if (state.status === "ready" && state.eventCount === 1057) break;
        assert.notEqual(state.status, "failed"); assert.ok(Date.now() < deadline); await page.waitForTimeout(100);
      }
      await page.getByRole("button", { name: "刷新团队录像", exact: true }).click(); await page.getByText("已读取 1057 条", { exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const button = document.querySelector('[data-replay-track="player"] button.event-marker');
        return Number(button?.textContent) > 20;
      });
      const marker = track("player").locator("button.event-marker").nth(5); await marker.click();
      const popup = page.locator('.ant-popover:not(.ant-popover-hidden) .event-popover'); await popup.waitFor();
      assert.equal(await popup.locator('.event-detail-row').count(), 20);
      const first = await popup.locator('.event-detail-row').first().getAttribute('data-event-id');
      await popup.getByRole("button", { name: "下一页分组事件", exact: true }).click();
      assert.notEqual(await popup.locator('.event-detail-row').first().getAttribute('data-event-id'), first);
      assert.equal(await popup.locator('.event-detail-row').count(), 20);
      const row = popup.locator('.event-detail-row').last(), id = await row.getAttribute('data-event-id');
      const actual = (await stack.request(eventsRoute)).events.find((event) => event.eventId === id); assert.ok(actual);
      await row.locator('button').click(); await seeked(a.videoZeroMs / 1000 + Math.max(0, actual.pullTimeMs / 1000 - 3));
      await closePanel(); await page.screenshot({ path: path.join(output, "tracks-390.png"), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
    });
    assert.deepEqual(report.pageErrors, []); report.passed = true; await page.screenshot({ path: path.join(output, "tracks-1440.png"), fullPage: true });
  } catch (error) { report.passed = false; report.failure = String(error.stack || error); if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {}); throw error; }
  finally { if (browser) await browser.close(); if (site) await site.close(); report.cleanup = await stack.close(); fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
