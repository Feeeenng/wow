const assert = require("node:assert/strict");
const path = require("node:path");

/** 所有绘制通过实际指针和SVG，保存与竞争通过独立真实API／PG。 */
exports.verifyAnnotations = async ({ page, browser, stack, info, site, a, b, run, login, expectTime, output, pageErrors }) => {
  const canvas = () => page.locator("svg[data-annotation-canvas]");
  const shapes = () => canvas().locator("g[data-annotation-id]");
  const route = "/teams/" + info.teamId + "/recordings/" + a.recordingId + "/annotations";
  const open = async () => { await page.getByRole("button", { name: "视频标注工具", exact: true }).click(); await page.getByRole("combobox", { name: "标注工具", exact: true }).waitFor(); };
  const select = async (text) => {
    await page.getByRole("combobox", { name: "标注工具", exact: true }).click();
    const popup = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
    await popup.locator(".ant-select-item-option-content").getByText(text, { exact: true }).click(); await popup.waitFor({ state: "hidden" });
  };
  const draw = async (from, to, curved = false) => {
    const box = await canvas().boundingBox(); assert.ok(box?.width);
    const at = (p) => ({ x: box.x + p[0] * box.width, y: box.y + p[1] * box.height });
    const start = at(from), end = at(to); await page.mouse.move(start.x, start.y); await page.mouse.down();
    if (curved) await page.mouse.move((start.x + end.x) / 2, end.y - 8, { steps: 4 });
    await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
  };
  const save = async () => {
    await page.getByRole("button", { name: "保存标注", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-annotation-toolbar] .ant-btn-loading'));
  };
  const dirty = () => page.getByText("标注未保存", { exact: true });
  const choose = (name) => page.getByRole("button", { name: "观看" + name + "视角", exact: true }).click();
  const layoutReady = () => page.waitForFunction(() => {
    const svg = document.querySelector('svg[data-annotation-canvas]'), video = document.querySelector('video[aria-label="团队回放"]');
    if (!svg || !video) return false;
    const a = svg.getBoundingClientRect(), b = video.getBoundingClientRect();
    const scale = Math.min(b.width / video.videoWidth, b.height / video.videoHeight);
    return Math.abs(a.width - video.videoWidth * scale) < 1 && Math.abs(a.height - video.videoHeight * scale) < 1
      && Math.abs(a.top - (b.top + (b.height - a.height) / 2)) < 1;
  });
  const seek = async (seconds) => {
    const video = page.getByLabel("团队回放", { exact: true });
    await video.evaluate((element, time) => { element.pause(); element.currentTime = time; }, a.videoZeroMs / 1000 + seconds);
    await expectTime(page, a.videoZeroMs / 1000 + seconds);
  };
  await run("网页真实六种图形绘制、字面文字、黑边坐标及撤销重做", async () => {
    await open(); await layoutReady();
    const box = await canvas().boundingBox();
    assert.ok(Math.abs(box.width / box.height - 16 / 9) < 0.001);
    for (const [name, kind] of [["箭头", "arrow"], ["画笔", "pen"], ["方框", "rect"], ["圆圈", "ellipse"]]) {
      await select(name); await draw([0.15, 0.62], [0.32, 0.82], kind === "pen");
      assert.equal(await canvas().locator("g[data-annotation-kind='" + kind + "']").count(), 1);
    }
    await select("文字"); await page.getByRole("textbox", { name: "标注文字", exact: true }).fill("<script>字面文字</script>");
    await draw([0.4, 0.82], [0.4, 0.82]); assert.equal(await canvas().locator("script").count(), 0);
    assert.equal(await canvas().getByText("<script>字面文字</script>", { exact: true }).count(), 1);
    await select("团队标记"); await page.getByRole("textbox", { name: "标注文字", exact: true }).fill("集合"); await draw([0.6, 0.82], [0.6, 0.82]);
    assert.equal(await shapes().count(), 6);
    await page.getByRole("button", { name: "撤销标注", exact: true }).click(); assert.equal(await shapes().count(), 5);
    await page.getByRole("button", { name: "重做标注", exact: true }).click(); assert.equal(await shapes().count(), 6);
  });
  await run("网页标注跨视角草稿隔离、真实保存及非上传成员只读", async () => {
    await choose("网页视角乙"); await expectTime(page, b.videoZeroMs / 1000 + 3); assert.equal(await shapes().count(), 0);
    assert.equal(await page.locator("video").count(), 1);
    await choose("网页视角甲"); await expectTime(page, a.videoZeroMs / 1000 + 3);
    await page.waitForFunction(() => document.querySelectorAll('svg[data-annotation-canvas] g[data-annotation-id]').length === 6);
    await open(); await save(); await dirty().waitFor({ state: "hidden" });
    const snapshot = await stack.request(route); assert.equal(snapshot.version, 1); assert.equal(snapshot.items.length, 6);
    for (const item of snapshot.items) {
      assert.ok(Math.abs(item.atMs - 3000) < 60);
      for (const p of item.points) assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const guest = await context.newPage(); guest.on("pageerror", (error) => pageErrors.push(error.message));
      await guest.goto(site.origin + "?team=" + info.teamId + "&pull=" + info.teamPullId + "&view=" + a.recordingId + "&t=3");
      await login(guest, info.observerToken); await expectTime(guest, a.videoZeroMs / 1000 + 3);
      await guest.getByRole("button", { name: "视频标注工具", exact: true }).click();
      await guest.getByText("当前只可查看标注。", { exact: true }).waitFor();
      assert.equal(await guest.getByRole("combobox", { name: "标注工具", exact: true }).isDisabled(), true);
      assert.equal(await guest.locator("svg[data-annotation-canvas] g[data-annotation-id]").count(), 6);
      const denied = await fetch(info.endpoint + "/api/v1" + route, { method: "PUT", headers: { Authorization: "Bearer " + info.observerToken, "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: 1, items: [] }) });
      assert.equal(denied.status, 403);
    } finally { await context.close(); }
  });
  await run("网页标注两成员CAS冲突保留草稿，确认读取后才替换", async () => {
    await select("箭头"); await draw([0.68, 0.62], [0.8, 0.82]); assert.equal(await shapes().count(), 7);
    await stack.command("observerAnalyst");
    try {
      const old = await stack.request(route);
      await stack.request(route, "PUT", { expectedVersion: old.version, items: old.items }, info.observerToken);
      await save(); await page.getByText("标注版本已更新，当前草稿仍保留", { exact: true }).waitFor();
      assert.equal(await shapes().count(), 7); assert.equal((await stack.request(route)).items.length, 6);
      await page.getByRole("button", { name: "读取最新", exact: true }).click();
      await page.getByRole("button", { name: /确.?定/ }).click(); await dirty().waitFor({ state: "hidden" }); assert.equal(await shapes().count(), 6);
    } finally { await stack.command("observerMember"); }
  });
  await run("网页标注按战斗时段显隐、预滚禁止绘制及全屏缩放不改坐标", async () => {
    const before = await stack.request(route);
    await seek(9); assert.equal(await shapes().count(), 0);
    await page.getByLabel("团队回放", { exact: true }).evaluate((v) => { v.currentTime = 0.5; });
    await page.getByText("当前画面不在可定位的战斗范围内，返回战斗时间后可编辑标注。", { exact: true }).waitFor();
    assert.equal(await canvas().count(), 0); await seek(3); await canvas().waitFor();
    await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
    await page.locator("media-fullscreen-button").click(); await page.waitForFunction(() => !!document.fullscreenElement);
    assert.equal(await shapes().count(), 6); await open(); await select("箭头");
    assert.equal(await page.getByRole("combobox", { name: "标注工具", exact: true }).evaluate((element) => !!element.closest("media-controller:fullscreen")), true);
    await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
    await page.locator("media-fullscreen-button").click(); await page.waitForFunction(() => !document.fullscreenElement);
    for (const size of [{ width: 1080, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await layoutReady();
      assert.equal(await shapes().count(), 6);
      for (const name of ["media-play-button", "media-time-range", "media-fullscreen-button"]) {
        const control = await page.locator(name).boundingBox();
        assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('svg[data-annotation-canvas]'),
          { x: control.x + control.width / 2, y: control.y + control.height / 2 }), false);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await layoutReady();
    await page.screenshot({ path: path.join(output, "web-annotations-1440.png"), fullPage: true });
    assert.deepEqual(await stack.request(route), before);
  });
};
