const assert = require("node:assert/strict");
const path = require("node:path");

// 仅由隔离真实云端验收入口调用，不创建正式数据或读取用户录像。
module.exports = async function verifyAnnotations({ getPage, invoke, run, info, remote, players, output, report, close, launch, requestBridge }) {
  const recording = remote.find((item) => item.playerName === players[1].name);
  const other = remote.find((item) => item.playerName === players[0].name);
  const load = () => invoke("get_cloud_replay_annotations", { pullId: recording.pullId });
  const save = (request) => invoke("save_cloud_replay_annotations", { pullId: recording.pullId, request });
  const waitSnapshot = async (version) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const value = await load(); if (value.version === version) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
    throw new Error(`真实标注版本未更新至 ${version}`);
  };
  await run("原生鼠标画笔撤销重做与真实PG保存，跨视角标注隔离", async () => {
    const page = getPage();
    await page.getByRole("button", { name: `观看${players[1].name}视角`, exact: true }).click();
    const before = await load(); assert.equal(before.version, 0); assert.equal(before.canEdit, true);
    await page.getByRole("button", { name: "视频标注工具", exact: true }).click();
    const deadline = Date.now() + 10000;
    while (await page.getByRole("combobox", { name: "标注工具", exact: true }).isDisabled()) {
      if (Date.now() > deadline) throw new Error("原生画笔工具未读取到编辑权限"); await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const canvas = page.getByLabel("视频标注画布", { exact: true }); await canvas.waitFor();
    const box = await canvas.boundingBox(); assert.ok(box?.width > 100);
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6); await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.8, { steps: 8 }); await page.mouse.up();
    await canvas.locator('[data-annotation-kind="arrow"]').waitFor();
    await page.getByRole("button", { name: "撤销标注", exact: true }).click(); assert.equal(await canvas.locator("[data-annotation-id]").count(), 0);
    await page.getByRole("button", { name: "重做标注", exact: true }).click(); await canvas.locator('[data-annotation-kind="arrow"]').waitFor();
    await page.getByRole("button", { name: "保存标注", exact: true }).click();
    const saved = await waitSnapshot(1); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].kind, "arrow");
    assert.ok(saved.items[0].atMs >= 0 && saved.items[0].atMs <= 10000); assert.ok(Math.abs(saved.items[0].points[0].x - 0.2) < 0.01);
    await page.getByRole("button", { name: `观看${players[0].name}视角`, exact: true }).click();
    assert.equal((await invoke("get_cloud_replay_annotations", { pullId: other.pullId })).items.length, 0);
    await page.getByRole("button", { name: `观看${players[1].name}视角`, exact: true }).click();
    await page.locator('[data-annotation-kind="arrow"]').waitFor();
    await page.screenshot({ path: path.join(output, "native-real-annotations.png"), fullPage: true });
    report.annotations = { drawnWithMouse: true, undoRedo: true, viewIsolation: true };
  });
  await run("真实PG并发CAS仅一次成功，旧版本拒写且原生重启恢复", async () => {
    const before = await load();
    const requests = ["#2266FF", "#44CC88"].map((color) => ({ expectedVersion: before.version, items: before.items.map((item) => ({ ...item, color })) }));
    const results = await Promise.allSettled(requests.map(save)); assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.ok(String(results.find((item) => item.status === "rejected").reason).includes("409"));
    const after = await load(); assert.equal(after.version, before.version + 1); assert.equal(after.items.length, 1);
    const evidence = await requestBridge("inspect"); assert.equal(evidence.annotations.length, 1); assert.equal(evidence.annotations[0].version, after.version);
    // 此处验证标注重启，先等回放源／选中视角防抖写入，避免重启加载上次本地源。
    const deadline = Date.now() + 10000; let preferences;
    do { preferences = await invoke("get_replay_preferences"); if (preferences.catalogSource === "team" && preferences.selectedPullId === recording.pullId) break; await new Promise((resolve) => setTimeout(resolve, 100)); } while (Date.now() < deadline);
    assert.equal(preferences.catalogSource, "team"); assert.equal(preferences.selectedPullId, recording.pullId);
    await close(); await launch(); await invoke("verify_cloud_connection");
    const restored = await load(); assert.deepEqual(restored.items, after.items); assert.equal(restored.version, after.version);
    const page = getPage(); await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
    await page.getByRole("button", { name: `观看${players[1].name}视角`, exact: true }).click(); await page.locator('[data-annotation-kind="arrow"]').waitFor();
    report.annotations.concurrentCas = true; report.annotations.survivedRestart = true;
  });
  await run("另一个普通成员原生只读禁用，分析员可写，切回上传者", async () => {
    await invoke("set_cloud_settings", { settings: { endpoint: info.endpoint, teamId: info.teamId, token: info.observerToken } }); await invoke("verify_cloud_connection");
    const member = await load(); assert.equal(member.canEdit, false);
    let denied = false; try { await save({ expectedVersion: member.version, items: member.items }); } catch (error) { denied = String(error).includes("403"); } assert.equal(denied, true);
    // 原生 IPC 成功后，应用级轮询仍需发布新身份；等待后再展开，避免安全重置收起工具。
    const page = getPage(); await page.getByText(/^原生只读成员/).first().waitFor(); await page.getByRole("button", { name: "刷新团队录像", exact: true }).click();
    await page.getByRole("button", { name: `观看${players[1].name}视角`, exact: true }).click();
    await page.getByRole("button", { name: "视频标注工具", exact: true }).click(); await page.getByText("当前只可查看标注。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "标注工具", exact: true }).isDisabled(), true);
    await requestBridge("observerAnalyst"); await invoke("verify_cloud_connection");
    const analyst = await load(); assert.equal(analyst.canEdit, true); const changed = await save({ expectedVersion: analyst.version, items: analyst.items }); assert.equal(changed.version, analyst.version + 1);
    await invoke("set_cloud_settings", { settings: { endpoint: info.endpoint, teamId: info.teamId, token: info.token } }); await invoke("verify_cloud_connection");
    await page.getByText(info.displayName, { exact: true }).waitFor();
    report.annotations.memberReadOnly = true; report.annotations.analystCanEdit = true;
  });
};
