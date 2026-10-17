const assert = require("node:assert/strict");
const path = require("node:path");

// 由真实全栈验收提供当前原生页面及随机团队；仅使用合成媒体和真实PG。
module.exports = async ({ getPage, invoke, run, info, remote, players, output, report, close, launch, requestBridge }) => {
  const a = remote.find((item) => item.playerName === players[0].name), b = remote.find((item) => item.playerName === players[1].name);
  const baseA = 3 + a.mapping.videoZeroMs / 1000, baseB = 3 + b.mapping.videoZeroMs / 1000;
  const state = report.calibration = {};
  const expectTime = (seconds) => getPage().waitForFunction((expected) => {
    const video = document.querySelector("video[aria-label$='团队回放']");
    // 容差小于本用例100ms个人值，避免重复叠加仍被宽容差掩盖。
    return video?.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - expected) < 0.06;
  }, seconds);
  const open = () => getPage().getByRole("button", { name: "对齐微调", exact: true }).click();
  const leave = () => getPage().getByText("战斗时间轴", { exact: true }).click();
  const fill = async (name, value) => { const input = getPage().getByRole("spinbutton", { name, exact: true }); await input.fill(String(value)); await input.press("Tab"); };
  let version, shared = 500;

  await run("真实界面保存团队偏移，PG落盘且本机微调只叠加一次", async () => {
    await getPage().getByRole("button", { name: `观看${players[0].name}视角`, exact: true }).click(); await expectTime(baseA);
    await open(); await getPage().getByRole("spinbutton", { name: "团队对齐偏移", exact: true }).waitFor();
    await getPage().waitForFunction(() => !document.querySelector('[aria-label="团队对齐偏移"]')?.disabled);
    await fill("团队对齐偏移", 500); await getPage().getByRole("button", { name: "保存团队对齐", exact: true }).click();
    await expectTime(baseA + 0.5);
    const first = await invoke("get_cloud_replay_calibration", { pullId: a.pullId }); assert.equal(first.version, 1); assert.equal(first.offsetMs, 500); assert.equal(first.active, true);
    assert.equal((await invoke("get_replay_preferences")).offsetsMs[a.pullId] ?? 0, 0);
    const database = (await requestBridge("inspect")).recordings.find((item) => item.recordingId === a.pullId);
    assert.equal(database.sharedCalibration.offsetMs, 500); assert.equal(database.videoZeroMs - 300, a.mapping.videoZeroMs);
    await fill("本机对齐偏移", 100); await expectTime(baseA + 0.6); await leave();
    await getPage().getByRole("button", { name: `观看${players[1].name}视角`, exact: true }).click(); await expectTime(baseB);
    await getPage().getByRole("button", { name: `观看${players[0].name}视角`, exact: true }).click(); await expectTime(baseA + 0.6);
    state.mouseSaved = true; state.databaseSaved = true; state.personalAddedOnce = true; state.otherPovIndependent = true;
  });

  await run("真实并发团队校准CAS及界面冲突保留未保存草稿", async () => {
    await open(); await fill("团队对齐偏移", 333);
    const results = await Promise.all([600, 700].map((offsetMs) => invoke("save_cloud_replay_calibration", {
      pullId: a.pullId, request: { expectedVersion: 1, playbackVersion: a.cloudPlaybackVersion, offsetMs },
    }).then((value) => ({ value }), () => ({ denied: true }))));
    assert.equal(results.filter((item) => item.value).length, 1); assert.equal(results.filter((item) => item.denied).length, 1);
    shared = results.find((item) => item.value).value.offsetMs; version = 2;
    await getPage().getByRole("button", { name: "保存团队对齐", exact: true }).click();
    await getPage().getByText(/团队对齐或录像版本已变化/).waitFor();
    assert.equal(await getPage().getByRole("spinbutton", { name: "团队对齐偏移", exact: true }).inputValue(), "333");
    assert.equal((await invoke("get_cloud_replay_calibration", { pullId: a.pullId })).offsetMs, shared);
    await fill("团队对齐偏移", 500); await getPage().getByRole("button", { name: "读取最新团队对齐", exact: true }).click();
    await expectTime(baseA + (shared + 100) / 1000); await leave();
    state.concurrentCas = true; state.conflictKeptDraft = true;
  });

  await run("其他成员重新读取应用团队值，界面只读及原生写入拒绝", async () => {
    await invoke("set_cloud_settings", { settings: { endpoint: info.endpoint, teamId: info.teamId, token: info.observerToken } });
    const observer = await invoke("verify_cloud_connection");
    await getPage().getByRole("navigation").getByRole("button", { name: "个人中心", exact: true }).click();
    await getPage().getByRole("heading", { name: observer.displayName, exact: true }).waitFor();
    await getPage().getByRole("navigation").getByRole("button", { name: /回放/ }).click();
    await getPage().getByRole("button", { name: `观看${players[0].name}视角`, exact: true }).click(); await expectTime(baseA + (shared + 100) / 1000);
    await open(); await getPage().getByText("当前账号只读；上传者、团长或分析员可以保存。", { exact: true }).waitFor();
    assert.equal(await getPage().getByRole("button", { name: "保存团队对齐", exact: true }).isDisabled(), true);
    let denied = false; try { await invoke("save_cloud_replay_calibration", { pullId: a.pullId, request: { expectedVersion: version, playbackVersion: a.cloudPlaybackVersion, offsetMs: 0 } }); } catch { denied = true; } assert.equal(denied, true);
    await leave(); await invoke("set_cloud_settings", { settings: { endpoint: info.endpoint, teamId: info.teamId, token: info.token } }); await invoke("verify_cloud_connection");
    await getPage().getByRole("navigation").getByRole("button", { name: "个人中心", exact: true }).click(); await getPage().getByRole("heading", { name: info.displayName, exact: true }).waitFor();
    await close(); await launch(); await invoke("verify_cloud_connection");
    await getPage().getByRole("navigation").getByRole("button", { name: /回放/ }).click(); await expectTime(baseA + (shared + 100) / 1000);
    assert.equal((await invoke("get_cloud_replay_calibration", { pullId: a.pullId })).version, version);
    state.otherMemberApplied = true; state.readOnlyVerified = true; state.restartRestored = true;
  });

  await run("发布版本变化使团队校准失效，复核保存后重新应用", async () => {
    await requestBridge("calibrationVersion");
    await getPage().getByRole("button", { name: "刷新团队录像", exact: true }).click(); await expectTime(baseA);
    await open(); await getPage().getByText("录像版本已变化，旧团队偏移未应用；请按当前画面复核后再保存。", { exact: true }).waitFor();
    await getPage().getByRole("button", { name: "保存团队对齐", exact: true }).click(); await expectTime(baseA + shared / 1000);
    await getPage().getByRole("button", { name: "复核并应用原本机偏移", exact: true }).click(); await expectTime(baseA + (shared + 100) / 1000);
    await getPage().screenshot({ path: path.join(output, "native-team-calibration.png"), fullPage: true });
    await getPage().setViewportSize({ width: 1080, height: 720 });
    const popup = getPage().locator(".ant-popover:visible"); const bounds = await popup.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1081 && bounds.y >= 0 && bounds.y + bounds.height <= 721);
    assert.equal(await getPage().evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await getPage().screenshot({ path: path.join(output, "native-team-calibration-1080.png"), fullPage: true });
    await getPage().setViewportSize({ width: 1440, height: 900 });
    await fill("团队对齐偏移", 0); await getPage().getByRole("button", { name: "保存团队对齐", exact: true }).click(); await expectTime(baseA + 0.1);
    await fill("本机对齐偏移", 0); await expectTime(baseA); await leave();
    state.artifactInvalidated = true; state.personalArtifactInvalidated = true; state.explicitlyReviewed = true;
  });
  const fresh = await invoke("list_cloud_replays", { offset: 0, limit: 100 });
  remote.splice(0, remote.length, ...fresh);
  const beforeRevoke = await getPage().evaluate(async (url) => (await fetch(url)).status, remote[0].playbackUrl);
  assert.equal(beforeRevoke, 200, "撤权前必须证明当前媒体版本可访问");
};
