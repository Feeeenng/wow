const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { loadSource } = require("./source-loader.cjs");
const { reviewMechanics } = loadSource("../shared/review/mechanics/classification.ts");

const hashFile = async (file) => {
  const digest = crypto.createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  return digest.digest("hex");
};
const timeLabel = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** 真实死亡日志配合明确标注的同源媒体控制视角，只验证切换机制，不冒充其他成员实拍。 */
exports.prepareDeathReview = async ({ selected, sourceIndex, output }) => {
  const death = selected.timelineEvents.find((event) => event.kind === "death" && event.targetGuid === selected.recordingPlayerGuid);
  assert.ok(death, "所选实战样本缺少本人死亡");
  const log = selected.logFileId.slice(0, selected.logFileId.lastIndexOf("#")), sourceHash = await hashFile(log);
  const auditPath = path.join(output, "independent-death-audit.json");
  const result = spawnSync(path.resolve(__dirname, "../../backend/.venv/Scripts/python.exe"), [path.join(__dirname, "audit-death-review.py"),
    "--index", sourceIndex, "--pull", selected.pullId, "--event", death.eventId, "--output", auditPath], { windowsHide: true, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  assert.equal(result.status, 0, result.stderr);
  const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
  const healer = audit.rows.find((row) => row.kind === "heal" && row.sourceGuid.startsWith("Player-") && row.sourceGuid !== death.targetGuid);
  if (!healer) return { death, audit, log, sourceHash, related: null, gap: null, extras: [], outsideId: null };
  const id = (label) => crypto.createHash("sha256").update(selected.pullId + label + path.resolve(output)).digest("hex");
  const related = { ...selected, pullId: id("related-control"), playerName: "验收关联视角", recordingPlayerGuid: healer.sourceGuid };
  const gap = { ...related, pullId: id("gap-control"), playerName: "验收缺片视角", state: "partial",
    mapping: { ...selected.mapping, hasGap: true, mediaCalibrated: true, intervals: [] } };
  const outside = { ...related, pullId: id("outside-control"), playerName: "验收其他战斗", battleKey: "independent-other-battle" };
  const errorDirectory = path.join(output, "error-log-fixtures"); assert.equal(fs.existsSync(errorDirectory), false); fs.mkdirSync(errorDirectory);
  const headerBuffer = Buffer.alloc(2048), headerSource = fs.openSync(log, "r");
  try { fs.readSync(headerSource, headerBuffer, 0, headerBuffer.length, 0); } finally { fs.closeSync(headerSource); }
  const header = headerBuffer.toString("utf8").split("\n")[0] + "\n";
  const errorControls = ["missingLog", "unsupportedLog", "sourceChanged"].map((availability, index) => {
    const pullId = id(availability), source = path.join(errorDirectory, "WoWCombatLog-101626_00000" + index + ".txt");
    if (availability !== "missingLog") fs.writeFileSync(source, availability === "unsupportedLog" ? "unsupported-log-header\n" : header);
    const control = { ...selected, pullId, battleKey: "source-error-" + pullId, logFileId: source + "#0", timelineVersion: 3,
      timelineEvents: selected.timelineEvents.map((event) => ({ ...event, eventId: pullId + event.eventId.slice(selected.pullId.length) })) };
    return { availability, source, control, death: { ...death, eventId: pullId + death.eventId.slice(selected.pullId.length) } };
  });
  return { death, audit, log, sourceHash, related, gap, extras: [related, gap, outside, ...errorControls.map((item) => item.control)], outsideId: outside.pullId, errorControls, errorDirectory, header };
};

/** 无论断言成功或失败，都只清理本次独立目录内明确命名的日志夹具。 */
exports.cleanupDeathFixtures = (prepared) => {
  if (!prepared?.errorControls) return;
  const root = path.resolve(prepared.errorDirectory);
  for (const item of prepared.errorControls) {
    assert.ok(path.resolve(item.source).startsWith(root + path.sep));
    assert.match(path.basename(item.source), /^WoWCombatLog-101626_00000[0-2]\.txt$/);
    if (fs.existsSync(item.source)) fs.unlinkSync(item.source);
  }
  if (fs.existsSync(root)) fs.rmdirSync(root);
};

/** 在独立Tauri／真实WebView2中读取实际Rust命令、比较独立CSV审计并操作生产界面。 */
exports.verifyDeathReview = async ({ page, invoke, selected, events, sourceIndex, output, prepared }) => {
  const report = { cases: [], boundary: "原生日志和本人实拍／HLS只读；关联及缺片视角为同源媒体的隔离控制样本，不代表多成员实拍；不使用云服务或API响应替换" };
  const run = async (name, verify) => { await verify(); report.cases.push({ name, passed: true }); console.log("PASS " + name); };
  const video = page.locator("video[aria-label$='本地回放']");
  const drawer = page.locator(".death-review-drawer");
  const waitRead = async () => {
    await drawer.getByText("来源：本地高级战斗日志", { exact: false }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.death-review-body [role="status"]'));
  };
  const chooseDeath = async (death, ready = true) => {
    const picker = drawer.getByRole("combobox", { name: "选择死亡记录", exact: true });
    await picker.fill(death.targetName);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByText(`${death.targetName} · ${timeLabel(death.pullTimeMs)} · ${death.pullTimeMs} ms`, { exact: true }).click();
    if (ready) await waitRead();
  };
  const expectTime = async (pullMs) => {
    const mapping = selected.mapping;
    const intervals = mapping.mediaCalibrated && mapping.intervals.length ? mapping.intervals : [{ pullStartMs: -mapping.videoZeroMs,
      pullEndMs: mapping.mediaDurationMs - mapping.videoZeroMs, videoStartMs: 0, videoEndMs: mapping.mediaDurationMs }];
    const interval = intervals.find((row) => pullMs >= row.pullStartMs && pullMs < row.pullEndMs);
    assert.ok(interval);
    const seconds = (interval.videoStartMs + (pullMs - interval.pullStartMs) / (interval.pullEndMs - interval.pullStartMs) * (interval.videoEndMs - interval.videoStartMs)) / 1000;
    await page.waitForFunction((target) => { const video = document.querySelector("video[aria-label$='本地回放']"); return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target) < .1; }, seconds);
  };
  let review;
  await run("真实Rust死亡分页与独立CSV审计逐条数值一致", async () => {
    let cursor = null, pages = 0; const rows = [];
    do {
      const value = await invoke("get_local_death_review", { pullId: selected.pullId, eventId: prepared.death.eventId, cursor, limit: 250 });
      assert.equal(value.availability, "ready"); assert.equal(value.parseErrors, 0);
      if (review) assert.equal(value.revision, review.revision); else review = value;
      rows.push(...value.events); cursor = value.hasMore ? value.nextCursor : null; pages++;
      assert.ok(pages <= 20);
    } while (cursor);
    review = { ...review, events: rows }; assert.equal(rows.length, review.total);
    const numeric = rows.filter((row) => ["damage", "heal"].includes(row.kind));
    assert.equal(numeric.length, prepared.audit.rows.length);
    const actual = new Map(numeric.map((row) => [row.eventId, row]));
    for (const expected of prepared.audit.rows) for (const [key, value] of Object.entries(expected)) assert.equal(actual.get(expected.eventId)?.[key], value, expected.eventId + ":" + key);
    assert.equal(review.pairedRowsRemoved, prepared.audit.pairedRowsRemoved);
    assert.ok(review.victimRecordingIds.includes(selected.pullId));
    if (prepared.related) {
      assert.ok(review.relatedRecordingIds.includes(prepared.related.pullId)); assert.ok(review.relatedRecordingIds.includes(prepared.gap.pullId));
      assert.equal(review.relatedRecordingIds.includes(prepared.outsideId), false);
    }
    report.audit = { rows: numeric.length, total: rows.length, pages, healthSamples: numeric.filter((row) => row.health !== null).length, revision: review.revision };
  });
  await run("死亡面板与全局主题一致，实际伤害筛选和本人生命采样", async () => {
    await video.evaluate((element) => { element.pause(); element.dataset.reviewInstance = "same"; });
    await page.getByRole("button", { name: "死亡明细", exact: true }).click(); await chooseDeath(prepared.death);
    assert.equal(await video.evaluate((element) => element.dataset.reviewInstance), "same");
    assert.equal(await drawer.locator('[data-review-event]').count(), Math.min(25, review.total));
    const colors = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement), workbench = getComputedStyle(document.querySelector(".replay-workspace"));
      const panel = document.querySelector(".death-review-body").closest(".ant-drawer-body").parentElement;
      return { rootPrimary: root.getPropertyValue("--app-primary"), workbenchPrimary: workbench.getPropertyValue("--app-primary"), rootSurface: root.getPropertyValue("--app-surface").trim(), drawerBackground: getComputedStyle(panel).backgroundColor };
    });
    assert.equal(colors.rootPrimary, colors.workbenchPrimary); assert.equal(colors.rootPrimary.trim(), "#1677ff"); assert.equal(colors.drawerBackground, "rgb(255, 255, 255)");
    report.theme = colors;
    const searchType = (review.events.find((event) => event.kind === "damage") ?? review.events[0]).rawType;
    await drawer.getByRole("textbox", { name: "搜索死亡明细", exact: true }).fill(searchType);
    const shown = await drawer.locator('[data-review-event]').evaluateAll((rows) => rows.map((row) => row.dataset.reviewEvent));
    assert.ok(shown.length); assert.ok(shown.every((id) => review.events.find((event) => event.eventId === id)?.rawType.includes(searchType)));
    await drawer.getByRole("textbox", { name: "搜索死亡明细", exact: true }).fill("");
    if (review.total > 25) {
      await drawer.getByRole("region", { name: "死亡窗口事件明细", exact: true }).locator(".ant-pagination-next").click();
      assert.equal(await drawer.locator('[data-review-event]').first().getAttribute("data-review-event"), review.events[25].eventId);
      await drawer.getByRole("region", { name: "死亡窗口事件明细", exact: true }).locator(".ant-pagination-prev").click();
    }
    if (review.events.some((event) => event.health !== null)) await drawer.getByRole("img", { name: /死者生命采样/ }).waitFor();
    else await drawer.getByText("日志没有提供明确属于死者的生命采样，不推算生命曲线。", { exact: true }).waitFor();
  });
  await run("真实减伤耗材记录与独立CSV身份一致，分类定位不改变媒体", async () => {
    const records = reviewMechanics(review), rawRecords = reviewMechanics({ ...review, events: prepared.audit.classificationRows });
    assert.deepEqual(records.map((row) => row.event.eventId), rawRecords.map((row) => row.event.eventId));
    const section = drawer.getByRole("region", { name: "减伤与治疗耗材记录", exact: true });
    await section.waitFor();
    assert.equal(await section.locator("[data-review-mechanic]").count(), Math.min(25, records.length));
    const actual = await section.locator("[data-review-mechanic]").evaluateAll((rows) => rows.map((row) => row.dataset.reviewMechanic));
    assert.deepEqual(actual, records.slice(0, 25).map((row) => row.event.eventId));
    if (records.length) {
      await section.getByRole("button", { name: "定位分类记录 " + records[0].event.eventId, exact: true }).click();
      await expectTime(records[0].event.pullTimeMs);
      assert.equal(await video.evaluate((element) => element.dataset.reviewInstance), "same");
    }
    report.mechanics = { records: records.length, independentRawRows: prepared.audit.classificationRows.length, spells: [...new Set(records.map((row) => row.event.spellId))] };
  });
  const consumableUses = events.filter((event) => [6262, 452930, 1262857, 1295247].includes(event.spellId) && event.kind === "castSuccess");
  // 优先覆盖同一窗口内多种真实耗材，避免只验到治疗石却宣称药水也已验证。
  const consumableDeath = events.filter((death) => death.kind === "death").map((death) => ({ death, spells: new Set(consumableUses.filter((event) => event.sourceGuid === death.targetGuid
    && death.pullTimeMs - event.pullTimeMs >= 0 && death.pullTimeMs - event.pullTimeMs <= 15000).map((event) => event.spellId)) }))
    .filter((entry) => entry.spells.size).sort((a, b) => b.spells.size - a.spells.size)[0]?.death;
  if (consumableDeath) await run("其他真实玩家的治疗石药水与独立CSV一致，不冒充本人录像", async () => {
    const auditPath = path.join(output, "independent-consumable-audit.json");
    const result = spawnSync(path.resolve(__dirname, "../../backend/.venv/Scripts/python.exe"), [path.join(__dirname, "audit-death-review.py"), "--index", sourceIndex,
      "--pull", selected.pullId, "--event", consumableDeath.eventId, "--output", auditPath], { windowsHide: true, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    assert.equal(result.status, 0, result.stderr);
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    let cursor = null, snapshot; const rows = [];
    do { const value = await invoke("get_local_death_review", { pullId: selected.pullId, eventId: consumableDeath.eventId, cursor, limit: 250 }); snapshot ??= value; rows.push(...value.events); cursor = value.hasMore ? value.nextCursor : null; } while (cursor);
    snapshot.events = rows;
    const records = reviewMechanics(snapshot), raw = reviewMechanics({ ...snapshot, events: audit.classificationRows });
    assert.deepEqual(records.map((row) => row.event.eventId), raw.map((row) => row.event.eventId));
    const consumables = records.filter((row) => row.kinds.includes("consumable"));
    assert.ok(consumables.some((row) => row.event.kind === "castSuccess"));
    await chooseDeath(consumableDeath);
    const section = drawer.getByRole("region", { name: "减伤与治疗耗材记录", exact: true });
    assert.deepEqual(await section.locator("[data-review-mechanic]").evaluateAll((items) => items.map((row) => row.dataset.reviewMechanic)), records.slice(0, 25).map((row) => row.event.eventId));
    const first = records.find((row) => row.kinds.includes("consumable"));
    const targetPage = Math.floor(records.indexOf(first) / 25) + 1;
    for (let current = 1; current < targetPage; current++) await section.locator(".ant-pagination-next").click();
    await section.getByRole("button", { name: "定位分类记录 " + first.event.eventId, exact: true }).click(); await expectTime(first.event.pullTimeMs);
    assert.equal(await video.evaluate((element) => element.dataset.reviewInstance), "same");
    assert.equal(snapshot.victimRecordingIds.includes(selected.pullId), false);
    report.consumables = { deathEventId: consumableDeath.eventId, records: consumables.map((row) => ({ eventId: row.event.eventId, spellId: row.event.spellId, kind: row.event.kind, itemIds: row.itemIds })), realVictimRecordingAvailable: snapshot.victimRecordingIds.includes(selected.pullId) };
    await section.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, "death-mechanics-real-consumables.png"), fullPage: true });
    await chooseDeath(prepared.death);
  });
  await run("实际死亡点及原事件定位，不重建媒体", async () => {
    await drawer.getByRole("button", { name: "定位死亡时刻", exact: true }).click(); await expectTime(prepared.death.pullTimeMs);
    assert.equal(await video.evaluate((element) => element.dataset.reviewInstance), "same");
    const first = drawer.locator('[data-review-event]').first(), id = await first.getAttribute("data-review-event");
    const row = review.events.find((event) => event.eventId === id); assert.ok(row);
    await first.getByRole("button").click(); await expectTime(row.pullTimeMs);
  });
  await run("本人及关联视角在死亡窗口定位，缺片入口禁用", async () => {
    const catalog = await invoke("list_local_recordings");
    report.views = catalog.map((row) => ({ id: row.pullId, state: row.state, mapping: row.mapping, error: row.error }));
    if (prepared.related) {
      assert.equal(await drawer.locator('[data-review-view="' + prepared.gap.pullId + '"]').isDisabled(), true);
      await drawer.locator('[data-review-view="' + prepared.related.pullId + '"]').click(); await expectTime(review.windowStartMs);
      assert.equal((await invoke("get_replay_preferences")).selectedPullId, prepared.related.pullId);
    }
    report.controlViewsPresent = !!prepared.related;
    await drawer.locator('[data-review-view="' + selected.pullId + '"]').click(); await expectTime(review.windowStartMs);
  });
  await run("换页后保留死亡快照，重新读取及切换死亡不混入旧页", async () => {
    await page.getByRole("navigation").getByRole("button", { name: /个人中心/ }).click();
    await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click(); await waitRead();
    await drawer.getByRole("button", { name: "重新读取死亡明细", exact: true }).click(); await waitRead();
    const other = events.find((event) => event.kind === "death" && event.eventId !== prepared.death.eventId); assert.ok(other);
    await chooseDeath(other); await chooseDeath(prepared.death);
    const ids = await drawer.locator('[data-review-event]').evaluateAll((rows) => rows.map((row) => row.dataset.reviewEvent));
    assert.ok(ids.every((id) => review.events.some((event) => event.eventId === id)));
    await page.setViewportSize({ width: 1080, height: 720 });
    await drawer.locator(".ant-drawer-body").evaluate((element) => { element.scrollTop = 0; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".death-review-drawer")).visibility !== "hidden");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, "death-review-1080.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: path.join(output, "death-review-1440.png"), fullPage: true, animations: "disabled" });
  });
  await run("无效死亡身份拒绝且源日志保持不变", async () => {
    await assert.rejects(invoke("get_local_death_review", { pullId: selected.pullId, eventId: "invalid", cursor: null, limit: 250 }));
    assert.equal(await hashFile(prepared.log), prepared.sourceHash); report.sourceLogUnchanged = true;
  });
  if (prepared.errorControls) await run("实际缺失／不支持／换源日志显示警告，源恢复后重新读取成功", async () => {
    for (const item of prepared.errorControls) {
      await drawer.locator(".ant-drawer-close").click();
      await page.locator('[data-replay-pull="' + item.control.pullId + '"]').click();
      await page.getByRole("button", { name: "死亡明细", exact: true }).click(); await chooseDeath(item.death, false);
      const snapshot = await invoke("get_local_death_review", { pullId: item.control.pullId, eventId: item.death.eventId, cursor: null, limit: 250 });
      assert.equal(snapshot.availability, item.availability);
      await drawer.getByRole("alert").getByText(snapshot.message, { exact: true }).waitFor();
      assert.equal(await drawer.locator('[data-review-event]').count(), 0);
      if (item.availability === "missingLog") {
        // 只复制本场原始范围到独立稀疏文件，保持字节身份；不改原日志，也不上传。
        fs.writeFileSync(item.source, prepared.header);
        const source = fs.openSync(prepared.log, "r"), target = fs.openSync(item.source, "r+");
        try {
          const buffer = Buffer.alloc(1024 * 1024); let position = selected.logStartOffset;
          while (position < selected.logEndOffset) {
            const size = fs.readSync(source, buffer, 0, Math.min(buffer.length, selected.logEndOffset - position), position);
            if (!size) break; fs.writeSync(target, buffer, 0, size, position); position += size;
          }
        } finally { fs.closeSync(source); fs.closeSync(target); }
        await drawer.getByRole("button", { name: "重新读取死亡明细", exact: true }).click(); await waitRead();
        assert.ok(await drawer.locator('[data-review-event]').count());
      }
    }
    exports.cleanupDeathFixtures(prepared); report.errorFixtureFragmentsRemoved = true;
    await drawer.locator(".ant-drawer-close").click(); await page.locator('[data-replay-pull="' + selected.pullId + '"]').click();
    await page.getByRole("button", { name: "死亡明细", exact: true }).click(); await chooseDeath(prepared.death);
  });
  await drawer.locator(".ant-drawer-close").click();
  // 等内容真正隐藏再截工作台，避免把收起动画的半透明残影误当成界面完成态。
  await drawer.locator(".ant-drawer-content-wrapper").waitFor({ state: "hidden" });
  report.passed = true;
  return report;
};
