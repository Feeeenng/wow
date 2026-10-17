const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TestCloudStack } = require("./real-stack.cjs");
const { startSite } = require("./site-server.cjs");
const { verifyAnnotations } = require("./browser-annotations.cjs");

const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument("--output")), playwright = require(path.resolve(argument("--playwright")));
const stack = new TestCloudStack({ python: path.resolve(argument("--python")), privateFile: path.resolve(argument("--private")), fixture: path.resolve(argument("--fixture")), output: path.join(output, "services") });
const report = { cases: [], pageErrors: [], boundary: "独立Web／真实浏览器／FastAPI／PG／私有MinIO／Redis／独立Celery；合成媒体及受控WCL HTTP，未上传实战数据" };
let browser, site, owner, observer; const requests = [];
fs.mkdirSync(output, { recursive: true });
const run = async (name, test) => { await test(); report.cases.push({ name, passed: true }); console.log("PASS " + name); };
const video = (page) => page.getByLabel("团队回放", { exact: true });
const expectTime = (page, target) => page.waitForFunction((expected) => {
  const element = document.querySelector("video[aria-label='团队回放']");
  return element && element.readyState >= 2 && !element.seeking && Math.abs(element.currentTime - expected) < 0.06;
}, target, { timeout: 20000 });
const login = async (page, token) => {
  await page.getByLabel("访问令牌", { exact: true }).fill(token);
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await page.getByRole("button", { name: "退出", exact: true }).waitFor();
};
const fill = async (page, name, value) => { const input = page.getByRole("spinbutton", { name, exact: true }); await input.fill(String(value)); await input.press("Tab"); };

async function main() {
  try {
    const info = await stack.start(), seeded = await stack.seed();
    site = await startSite(info.endpoint, requests);
    browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    owner = await context.newPage(); owner.on("pageerror", (error) => report.pageErrors.push(error.message));
    await owner.goto(site.origin);
    const a = seeded.records.find((item) => item.characterName === "网页视角甲"), b = seeded.records.find((item) => item.characterName === "网页视角乙");
    const baseA = a.videoZeroMs / 1000, baseB = b.videoZeroMs / 1000;
    const choose = async (name) => owner.getByRole("button", { name: "观看" + name + "视角", exact: true }).click();
    const seek = async (seconds) => {
      const axis = owner.getByRole("slider", { name: "跳转到敌方技能时间", exact: true }), box = await axis.boundingBox();
      await axis.click({ position: { x: Math.max(1, Math.min(box.width - 1, seconds / 10 * box.width)), y: box.height / 2 } });
    };
    const closePanel = () => owner.getByText("战斗时间轴", { exact: true }).click();

    await run("空凭证禁用、错误令牌清空及真实账号团队登录", async () => {
      assert.equal(await owner.getByRole("button", { name: "验证并进入", exact: true }).isDisabled(), true);
      await owner.getByLabel("访问令牌", { exact: true }).fill("intentionally-invalid-token");
      await owner.getByRole("button", { name: "验证并进入", exact: true }).click();
      await owner.getByText("身份验证已失效，请重新登录。", { exact: true }).waitFor();
      assert.equal(await owner.getByLabel("访问令牌", { exact: true }).inputValue(), "");
      await login(owner, info.token); await owner.getByText(info.displayName, { exact: true }).waitFor();
      assert.equal(await owner.evaluate(() => "__TAURI_INTERNALS__" in window), false);
    });
    await run("真实目录与三路视角，未上传人物禁用且只加载当前一路", async () => {
      await owner.getByRole("button", { name: "观看网页视角甲视角", exact: true }).waitFor();
      await choose("网页视角甲"); await expectTime(owner, baseA);
      assert.equal(await owner.getByRole("button", { name: "观看尚未上传成员视角", exact: true }).isDisabled(), true);
      const media = requests.filter((item) => item.path.includes("/media/"));
      assert.ok(media.length > 0 && media.every((item) => item.path.includes(a.recordingId)));
      assert.ok(media.every((item) => item.hasBearer && item.version === a.playbackVersion));
      assert.equal(await video(owner).evaluate((element) => element.videoWidth), 320);
    });
    await run("真实标准事件及离线图标，点击技能提前三秒定位", async () => {
      await owner.getByText("已读取 7 条", { exact: true }).waitFor();
      await owner.getByRole("button", { name: "标准圣盾术 施法成功 0:06", exact: true }).click(); await expectTime(owner, baseA + 3);
      assert.equal(await owner.locator("img[alt='标准圣盾术']").first().evaluate((image) => image.complete && image.naturalWidth > 0), true);
      await closePanel();
    });
    await verifyAnnotations({ page: owner, browser, stack, info, site, a, b, run, login, expectTime, output, pageErrors: report.pageErrors });
    await run("暂停切换视角保留战斗点及音量倍速", async () => {
      await video(owner).evaluate((element) => { element.pause(); element.volume = 0.4; element.playbackRate = 1.5; });
      await choose("网页视角乙"); await expectTime(owner, baseB + 3);
      assert.deepEqual(await video(owner).evaluate((element) => [element.paused, element.volume, element.playbackRate]), [true, 0.4, 1.5]);
      await choose("网页视角甲"); await expectTime(owner, baseA + 3);
    });
    await run("播放中切换只保留一路声音并继续共同游标", async () => {
      await video(owner).evaluate((element) => { element.muted = true; return element.play(); });
      await owner.waitForFunction((zero) => document.querySelector("video").currentTime > zero + 3.3, baseA);
      const before = await video(owner).evaluate((element, zero) => element.currentTime - zero, baseA);
      await choose("网页视角乙");
      await owner.waitForFunction((expected) => { const element = document.querySelector("video"); return element.readyState >= 2 && !element.paused && element.currentTime >= expected - 0.1 && element.currentTime < expected + 1; }, before + baseB);
      assert.equal(await owner.locator("video").count(), 1);
      await video(owner).evaluate((element) => element.pause()); await choose("网页视角甲"); await seek(3); await expectTime(owner, baseA + 3);
    });
    await run("缺片视角拒绝当前空洞，保留原画面与选择", async () => {
      await seek(5); await expectTime(owner, baseA + 5); await choose("缺片视角");
      await owner.getByText("该视角不覆盖当前战斗时间，已保留原视角。", { exact: true }).waitFor();
      assert.equal(await owner.getByRole("button", { name: "观看网页视角甲视角", exact: true }).getAttribute("aria-pressed"), "true");
      await expectTime(owner, baseA + 5); await seek(3); await expectTime(owner, baseA + 3);
    });
    await run("实际共享微调不能跨到另一拼接段，服务端也拒绝整段越界偏移", async () => {
      const gap = seeded.records.find((item) => item.characterName === "缺片视角");
      const route = "/teams/" + info.teamId + "/recordings/" + gap.recordingId + "/calibration";
      await stack.request(route, "PUT", { expectedVersion: 0, playbackVersion: gap.playbackVersion, offsetMs: 500 });
      const invalid = await fetch(info.endpoint + "/api/v1" + route, { method: "PUT", headers: { Authorization: "Bearer " + info.token, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, playbackVersion: gap.playbackVersion, offsetMs: 5000 }) });
      assert.equal(invalid.status, 422);
      await owner.getByRole("button", { name: "刷新团队录像", exact: true }).click(); await expectTime(owner, baseA + 3);
      await seek(3.8); await expectTime(owner, baseA + 3.8); await choose("缺片视角");
      await owner.getByText("该视角不覆盖当前战斗时间，已保留原视角。", { exact: true }).waitFor(); await expectTime(owner, baseA + 3.8);
      assert.equal(await owner.getByRole("button", { name: "观看网页视角甲视角", exact: true }).getAttribute("aria-pressed"), "true");
      await seek(3); await expectTime(owner, baseA + 3);
    });
    await run("事件筛选、同名报告人物区分及输入不触发全屏", async () => {
      await owner.locator('[aria-label="筛选事件类型"]').fill("死亡");
      await owner.getByText("死亡", { exact: true }).last().click(); await owner.keyboard.press("Escape"); await closePanel();
      assert.equal(await owner.getByRole("button", { name: /标准圣盾术 施法成功/ }).count(), 0);
      const filter = owner.locator(".ant-select").filter({ has: owner.locator('[aria-label="筛选事件类型"]') }); await filter.hover(); await filter.locator(".ant-select-clear").click();
      await owner.locator('[aria-label="筛选事件人物"]').click();
      await owner.getByText("同名标准角色 · #1", { exact: true }).last().waitFor(); await owner.getByText("同名标准角色 · #2", { exact: true }).last().waitFor(); await owner.keyboard.press("Escape");
      await owner.getByLabel("搜索战斗", { exact: true }).focus(); await owner.keyboard.press("t");
      assert.equal(await owner.evaluate(() => document.fullscreenElement !== null), false);
      await owner.getByLabel("搜索战斗", { exact: true }).fill("");
    });
    await run("界面保存共享及本机微调，只叠加一次且另一视角独立", async () => {
      await owner.getByRole("button", { name: "对齐微调", exact: true }).click();
      await owner.getByRole("spinbutton", { name: "团队对齐偏移", exact: true }).waitFor();
      await owner.waitForFunction(() => !document.querySelector('[aria-label="团队对齐偏移"]').disabled);
      await fill(owner, "团队对齐偏移", 500); await owner.getByRole("button", { name: "保存团队对齐", exact: true }).click(); await expectTime(owner, baseA + 3.5);
      await fill(owner, "本机对齐偏移", 100); await expectTime(owner, baseA + 3.6); await closePanel();
      await choose("网页视角乙"); await expectTime(owner, baseB + 3); await choose("网页视角甲"); await expectTime(owner, baseA + 3.6);
    });
    await run("网页冲突保留草稿，明确确认后读取最新团队值", async () => {
      await owner.getByRole("button", { name: "对齐微调", exact: true }).click(); await fill(owner, "团队对齐偏移", 333);
      await stack.request("/teams/" + info.teamId + "/recordings/" + a.recordingId + "/calibration", "PUT", { expectedVersion: 1, playbackVersion: a.playbackVersion, offsetMs: 600 });
      await owner.getByRole("button", { name: "保存团队对齐", exact: true }).click();
      await owner.getByText("数据或录像版本已变化，请读取最新内容后复核。", { exact: true }).waitFor();
      assert.equal(await owner.getByRole("spinbutton", { name: "团队对齐偏移", exact: true }).inputValue(), "333");
      await owner.getByRole("button", { name: "读取最新", exact: true }).click();
      await owner.getByRole("button", { name: /确.?定/ }).click(); await expectTime(owner, baseA + 3.7); await closePanel();
    });
    let link;
    await run("时间点链接无令牌且其他成员登录后应用共享值", async () => {
      await owner.getByRole("button", { name: "复制时间点链接", exact: true }).click();
      link = await owner.evaluate(() => navigator.clipboard.readText());
      const url = new URL(link); assert.equal(url.searchParams.get("view"), a.recordingId); assert.equal(url.searchParams.get("t"), "3"); assert.equal(link.includes(info.token), false);
      const guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); observer = await guestContext.newPage(); observer.on("pageerror", (error) => report.pageErrors.push(error.message));
      await observer.goto(link); await login(observer, info.observerToken); await expectTime(observer, baseA + 3.6);
      await observer.getByRole("button", { name: "对齐微调", exact: true }).click();
      await observer.getByText("当前账号只读；上传者、团长或分析员可以保存。", { exact: true }).waitFor();
      assert.equal(await observer.getByRole("button", { name: "保存团队对齐", exact: true }).isDisabled(), true);
    });
    await run("媒体换版暂停团队和本机旧值，复核后重新应用", async () => {
      await stack.command("calibrationVersion");
      await owner.getByRole("button", { name: "刷新团队录像", exact: true }).click(); await expectTime(owner, baseA + 3);
      await owner.getByRole("button", { name: "对齐微调", exact: true }).click();
      await owner.getByText("录像已换版，旧团队偏移未应用，请复核后保存。", { exact: true }).waitFor();
      await owner.getByRole("button", { name: "保存团队对齐", exact: true }).click(); await expectTime(owner, baseA + 3.6);
      await owner.getByRole("button", { name: "复核并应用", exact: true }).click(); await expectTime(owner, baseA + 3.7); await closePanel();
    });
    await run("真实1057事件分页重建，完整后发布且不混入旧快照", async () => {
      await stack.command("webBulkEvents");
      await stack.request("/teams/" + info.teamId + "/pulls/" + info.teamPullId + "/wcl/imports", "POST",
        { reportCode: info.wclReportCode, fightId: 1, actorBindings: stack.tasks.slice(0, 2).map((task, index) => ({ recordingId: task.recordingId, actorId: index + 1 })), refresh: true });
      const deadline = Date.now() + 60000;
      while (true) {
        const status = await stack.request("/teams/" + info.teamId + "/pulls/" + info.teamPullId + "/wcl");
        if (status.status === "ready" && status.eventCount === 1057) break;
        assert.ok(Date.now() < deadline); await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const start = requests.length; await owner.getByRole("button", { name: "刷新团队录像", exact: true }).click();
      await owner.getByText("已读取 1057 条", { exact: true }).waitFor();
      assert.ok(requests.slice(start).filter((item) => item.path.endsWith("/events")).length >= 2);
    });
    await run("初始清单损坏后重试读取新版本，保留尚未播放的链接战斗时间", async () => {
      await stack.command("webBreakMedia");
      const recoveryContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const recovery = await recoveryContext.newPage(); recovery.on("pageerror", (error) => report.pageErrors.push(error.message));
      await recovery.goto(link); await login(recovery, info.token);
      await recovery.getByRole("button", { name: "重新加载", exact: true }).waitFor({ timeout: 30000 });
      await stack.command("webRestoreMedia"); await stack.command("calibrationVersion");
      await recovery.getByRole("button", { name: "重新加载", exact: true }).click();
      await expectTime(recovery, baseA + 3); await recoveryContext.close();
    });
    await run("桌面及手机布局、全屏和时间点保留", async () => {
      await owner.getByRole("button", { name: "切换复盘全屏", exact: true }).click();
      await owner.waitForFunction(() => !!document.fullscreenElement); await owner.keyboard.press("t"); await owner.waitForFunction(() => !document.fullscreenElement);
      await owner.locator("media-fullscreen-button").click();
      await owner.waitForFunction(() => document.fullscreenElement?.tagName.toLowerCase() === "media-controller");
      assert.ok((await video(owner).boundingBox()).height > await owner.evaluate(() => innerHeight * 0.8));
      await owner.locator("media-fullscreen-button").click(); await owner.waitForFunction(() => !document.fullscreenElement);
      for (const [width, height] of [[1440, 900], [1080, 720], [390, 844]]) {
        await owner.setViewportSize({ width, height });
        assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await owner.screenshot({ path: path.join(output, "web-" + width + ".png"), fullPage: true });
      }
      await owner.getByRole("button", { name: "打开战斗目录", exact: true }).click(); await owner.getByRole("dialog").getByRole("button", { name: "观看网页视角乙视角", exact: true }).click();
      await expectTime(owner, baseB + 3); await owner.setViewportSize({ width: 1440, height: 900 });
    });
    await run("浏览器存储和URL不保存访问令牌，刷新后需重新验证", async () => {
      const stored = await owner.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
      assert.equal(stored.includes(info.token), false); assert.equal(stored.includes(info.observerToken), false);
      await observer.reload(); await observer.getByLabel("访问令牌", { exact: true }).waitFor(); assert.equal(await observer.getByLabel("访问令牌", { exact: true }).inputValue(), "");
    });
    await run("成员撤权后当前媒体及目录拒绝，另一成员仍可读", async () => {
      const current = await stack.request("/teams/" + info.teamId + "/recordings?limit=100"), item = current.find((value) => value.recordingId === a.recordingId);
      const address = "/api/v1/teams/" + info.teamId + "/recordings/" + item.recordingId + "/media/init.mp4?version=" + item.playbackVersion;
      const fetchStatus = (token) => owner.evaluate(async ({ address, token }) => (await fetch(address, { headers: { Authorization: "Bearer " + token } })).status, { address, token });
      assert.equal(await fetchStatus(info.token), 200); await stack.command("revoke");
      assert.ok(await fetchStatus(info.token) >= 400); assert.equal(await fetchStatus(info.observerToken), 200);
      await owner.getByRole("button", { name: "刷新团队录像", exact: true }).click();
      await owner.getByText("当前账号没有此操作的团队权限。", { exact: true }).first().waitFor();
      await owner.getByRole("button", { name: "退出", exact: true }).click(); await owner.getByLabel("访问令牌", { exact: true }).waitFor();
    });
    const media = requests.filter((item) => item.path.includes("/media/"));
    assert.ok(media.every((item) => item.hasBearer && item.version));
    assert.deepEqual(report.pageErrors, []); report.media = { requests: media.length, allBearerAndVersion: true }; report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = String(error.stack || error);
    if (owner) await owner.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close(); if (site) await site.close(); report.cleanup = await stack.close();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
