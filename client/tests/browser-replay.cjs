const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { loadSource } = require("./source-loader.cjs");
const { verifyExtendedEvents } = require("./browser-replay-events.cjs");
const { verifyGapOffsetBounds } = require("./browser-replay-gap.cjs");

// 浏览器运行真实 React/HLS.js 与合成 H.264/AAC；仅将 Tauri IPC 替换为可控测试边界。
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
const fixtureRoot = path.resolve(argument("--fixture"));
const outputRoot = path.resolve(argument("--output"));
const playwright = require(path.resolve(argument("--playwright")));
const clientRoot = path.resolve(__dirname, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "fixture.json"), "utf8"));
const spells = JSON.parse(fs.readFileSync(path.join(clientRoot, "src-tauri/resources/game-data/spells.json"), "utf8"));
const defaults = loadSource("src/features/obs/model.ts");
const { pullToVideo } = loadSource("../shared/replay/mapping.ts");
const report = { cases: [], pageErrors: [], consoleErrors: [], boundary: "真实网页与媒体，Tauri IPC 使用夹具；不替代实际桌面 IPC 验收" };
fs.mkdirSync(outputRoot, { recursive: true });

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const root = path.join(clientRoot, "dist");
  const filename = path.resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  const extension = path.extname(filename);
  const kinds = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
  if (!fs.existsSync(filename)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": kinds[extension] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await playwright.chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let corruptPlaylist = false;
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  await page.addInitScript(({ fixture, spells, defaults }) => {
    const state = window.__REPLAY_TEST__ = {
      fixture, metadataCalls: 0, listCalls: 0, imports: 0, retries: 0, failSave: false,
      extraRecordings: [],
      importPreferences: { directory: "", logPaths: [] }, importStarts: 0, importPolls: 0, importAutoComplete: true, failImportStart: false,
      importProgress: { taskId: null, status: "idle", totalRecordings: 0, processedRecordings: 0, importedCount: 0, skippedCount: 0, failedCount: 0, bytesRead: 0, totalBytes: 0, currentFile: null, error: null, issues: [], pullIds: [] },
      preferences: { selectedPullId: fixture.pullId, bookmarksMs: {}, offsetsMs: {}, volume: 1, muted: false, playbackRate: 1, eventKinds: [], actorGuid: null },
    };
    let callback = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command, args = {}) => {
        if (command === "get_replay_preferences") return structuredClone(state.preferences);
        if (command === "get_cloud_settings") return { endpoint: "", teamId: null, deviceId: "fixture-device", hasToken: false, identity: null, connectionKey: "" };
        if (command === "get_cloud_uploads") return [];
        if (command === "set_replay_preferences") {
          if (state.failSave) throw new Error("测试写入失败");
          state.preferences = structuredClone(args.preferences); return;
        }
        if (command === "list_local_recordings") { state.listCalls++; return [structuredClone(state.fixture), ...structuredClone(state.extraRecordings)]; }
        if (command === "get_spell_metadata") {
          state.metadataCalls++;
          return spells.spells.filter((spell) => args.spellIds.includes(spell.spellId)).map((spell) => ({
            spellId: spell.spellId, name: spell.name, iconUrl: `http://spell-icon.localhost/${spell.icon}`, source: spells.source,
          }));
        }
        if (command === "plugin:dialog|open") return args.options?.directory ? "C:/fixtures/recordings" : args.options?.multiple ? ["C:/fixtures/WoWCombatLog-first.txt", "C:/fixtures/WoWCombatLog-second.txt"] : "fixture-wcl.json";
        if (command === "get_recording_import_preferences") return structuredClone(state.importPreferences);
        if (command === "set_recording_import_preferences") { state.importPreferences = structuredClone(args.preferences); return; }
        if (command === "start_recording_import") {
          if (state.failImportStart) throw new Error("测试导入失败");
          state.importPolls = 0; state.importStarts++;
          state.importProgress = { ...state.importProgress, taskId: `import-${state.importStarts}`, status: "scanning", totalRecordings: 2, processedRecordings: 0, importedCount: 0, bytesRead: 0, totalBytes: 1000, currentFile: "fixture.mp4" };
          return structuredClone(state.importProgress);
        }
        if (command === "get_recording_import") {
          if (state.importAutoComplete && ["scanning", "indexing"].includes(state.importProgress.status)) {
            state.importPolls++;
            state.importProgress.status = state.importPolls > 2 ? "completed" : "indexing";
            state.importProgress.bytesRead = state.importPolls > 2 ? 1000 : 500;
            state.importProgress.processedRecordings = state.importPolls > 2 ? 2 : 1;
            state.importProgress.importedCount = state.importPolls > 2 ? 2 : 1;
          }
          return structuredClone(state.importProgress);
        }
        if (command === "cancel_recording_import") { state.importProgress.status = "cancelled"; return; }
        if (command === "import_spell_metadata") { state.imports++; return spells.spells.length; }
        if (command === "retry_recording_processing") { state.retries++; state.fixture.state = "ready"; state.fixture.error = null; return; }
        if (command === "get_obs_status") return defaults.disconnectedObsStatus;
        if (command === "get_obs_installation") return defaults.defaultInstallationStatus;
        if (command === "get_cached_obs_settings") return null;
        if (command === "get_live_session") return null;
        if (command === "get_local_replay_annotations" || command === "get_cloud_replay_annotations") return { version: 0, items: [], canEdit: true };
        if (command === "plugin:event|listen") return ++callback;
        if (command === "plugin:window|is_maximized") return false;
        return null;
      },
    };
  }, { fixture, spells, defaults: { disconnectedObsStatus: defaults.disconnectedObsStatus, defaultInstallationStatus: defaults.defaultInstallationStatus } });
  await page.route("http://spell-icon.localhost/**", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({ path: path.join(clientRoot, "src-tauri/resources/game-data/icons", name), contentType: "image/jpeg", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.route("http://local-replay.localhost/**", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    if (name === "index.m3u8" && corruptPlaylist) {
      await route.fulfill({ status: 200, body: "invalid-playlist", contentType: "application/vnd.apple.mpegurl", headers: { "Access-Control-Allow-Origin": "*" } }); return;
    }
    await route.fulfill({ path: path.join(path.dirname(fixture.playbackPath), name),
      contentType: name.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4",
      headers: { "Access-Control-Allow-Origin": "*" } });
  });
  const run = async (name, fn) => {
    await fn(); report.cases.push({ name, passed: true }); console.log(`PASS ${name}`);
  };
  const axis = () => page.getByRole("slider", { name: "跳转到敌方技能时间" });
  const seek = async (seconds) => {
    const bounds = await axis().boundingBox();
    await axis().click({ position: { x: Math.min(bounds.width - 1, Math.max(1, bounds.width * seconds / 10)), y: bounds.height / 2 } });
  };
  const expectTime = async (seconds) => {
    const target = pullToVideo(fixture, seconds).seconds;
    await page.waitForFunction((expected) => {
      const video = document.querySelector("video[aria-label$='本地回放']");
      return video && video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - expected) < 0.15;
    }, target, { timeout: 15000 });
  };
  const refresh = () => page.getByRole("button", { name: "刷新本地录像" }).click();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /回放/ }).click();
    await run("真实 H.264/AAC HLS 加载及书签起点", async () => {
      await expectTime(0);
      assert.equal(await page.locator("img[alt='圣盾术']").evaluate((image) => image.complete && image.naturalWidth > 0), true);
    });
    await run("连续跳转最后一次生效及键盘定位", async () => {
      await seek(9); await seek(2); await expectTime(2);
      await axis().focus(); await page.keyboard.press("Home"); await expectTime(0);
      await page.keyboard.press("ArrowRight"); await expectTime(1);
    });
    await run("播放暂停与战斗游标同步", async () => {
      const video = page.locator("video[aria-label$='本地回放']");
      await video.evaluate((media) => { media.muted = true; });
      await page.locator("media-play-button").click();
      await page.waitForFunction(() => Number(document.querySelector('[aria-label="跳转到敌方技能时间"]').getAttribute("aria-valuenow")) > 1.5);
      await page.locator("media-play-button").click();
      assert.equal(await video.evaluate((media) => media.paused), true);
      await seek(1); await expectTime(1);
    });
    await run("手动画面对齐微调及重置", async () => {
      await page.getByRole("button", { name: "对齐微调", exact: true }).click();
      await page.getByRole("spinbutton").fill("500");
      await page.getByRole("spinbutton").press("Tab");
      const base = pullToVideo(fixture, 1).seconds;
      await page.waitForFunction((expected) => Math.abs(document.querySelector('video[aria-label$="本地回放"]').currentTime - expected) < 0.15, base + 0.5);
      await page.getByRole("button", { name: /重\s*置/ }).click();
      await expectTime(1);
      await page.getByText("战斗时间轴", { exact: true }).click();
    });
    await run("图标分组保留各事件并提前三秒回看", async () => {
      await page.getByRole("button", { name: /圣盾术 施法成功.*等 2 个事件/ }).click();
      await page.getByRole("button", { name: /圣盾术 · 施法成功/ }).click();
      await expectTime(3);
      await page.getByText("战斗时间轴", { exact: true }).click();
    });
    await run("拖动预览只在松开后定位", async () => {
      const bounds = await axis().boundingBox();
      await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2, { steps: 8 });
      await expectTime(3);
      await page.mouse.up(); await expectTime(7);
    });
    await run("人物筛选及死亡事件提前回看", async () => {
      await page.locator('[aria-label="筛选事件人物"]').click();
      await page.getByText("测试队友", { exact: true }).click();
      await page.getByText("战斗时间轴", { exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('img[alt="圣盾术"]'));
      await page.getByRole("button", { name: /死亡 死亡/ }).click();
      await expectTime(0);
      await page.getByText("战斗时间轴", { exact: true }).click();
      const select = page.locator(".ant-select").filter({ has: page.locator('[aria-label="筛选事件人物"]') });
      await select.hover(); await select.locator(".ant-select-clear").click();
      await page.locator("img[alt='圣盾术']").waitFor();
    });
    await run("事件筛选与资料导入刷新", async () => {
      await page.locator('[aria-label="筛选事件类型"]').click();
      await page.locator('[aria-label="筛选事件类型"]').fill("死亡");
      await page.getByText("死亡", { exact: true }).last().click();
      await page.keyboard.press("Escape");
      await page.getByText("战斗时间轴", { exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('img[alt="圣盾术"]'));
      const select = page.locator(".ant-select").filter({ has: page.locator('[aria-label="筛选事件类型"]') });
      await select.hover(); await select.locator(".ant-select-clear").click();
      await page.getByRole("button", { name: "导入技能资料" }).click();
      await page.waitForFunction(() => window.__REPLAY_TEST__.imports === 1);
      await page.locator("img[alt='圣盾术']").waitFor();
    });
    await run("跨页面恢复战斗书签与媒体参数", async () => {
      await seek(7); await expectTime(7);
      await page.locator("video[aria-label$='本地回放']").evaluate((video) => { video.volume = 0.4; video.playbackRate = 1.5; });
      await page.waitForFunction((id) => window.__REPLAY_TEST__.preferences.bookmarksMs[id] > 6900, fixture.pullId);
      await page.getByRole("navigation").getByRole("button", { name: /首页/ }).click();
      await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
      await expectTime(7);
      const values = await page.locator("video[aria-label$='本地回放']").evaluate((video) => [video.volume, video.playbackRate, video.paused]);
      assert.deepEqual(values, [0.4, 1.5, true]);
    });
    await run("缺片目标明确提示且不跳到其他画面", async () => {
      await page.evaluate(() => {
        const mapping = window.__REPLAY_TEST__.fixture.mapping;
        mapping.hasGap = true;
        const zero = mapping.videoZeroMs;
        mapping.intervals = [
          { pullStartMs: 0, pullEndMs: 4000, videoStartMs: zero, videoEndMs: zero + 4000 },
          { pullStartMs: 6000, pullEndMs: 10000, videoStartMs: zero + 4000, videoEndMs: zero + 8000 },
        ];
      });
      await refresh();
      const before = await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime);
      await seek(5);
      await page.getByText("该战斗时段没有录像，请选择其他时间。", { exact: true }).waitFor();
      const after = await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime);
      assert.ok(Math.abs(before - after) < 0.1);
      await page.evaluate((mapping) => { window.__REPLAY_TEST__.fixture.mapping = mapping; }, fixture.mapping);
      await refresh();
    });
    await run("微调跨片段及原生进度反算不跳到无关画面", async () => {
      await verifyGapOffsetBounds({ page, fixture, refresh, seek, expectTime });
    });
    await run("偏好保存失败反馈及重新保存恢复", async () => {
      await page.evaluate(() => { window.__REPLAY_TEST__.failSave = true; });
      await seek(4); await expectTime(4);
      await page.getByText("回放偏好未能保存", { exact: true }).waitFor();
      await page.evaluate(() => { window.__REPLAY_TEST__.failSave = false; });
      await seek(6); await expectTime(6);
      await page.waitForFunction(() => !document.body.innerText.includes("回放偏好未能保存"));
    });
    await run("处理失败入口幂等重试", async () => {
      await page.evaluate(() => { window.__REPLAY_TEST__.fixture.state = "failed"; window.__REPLAY_TEST__.fixture.error = "测试处理失败"; });
      await refresh();
      await page.getByRole("button", { name: "重试处理", exact: true }).click();
      await page.waitForFunction(() => window.__REPLAY_TEST__.retries === 1);
      await expectTime(6);
    });
    await run("播放清单失败后重新加载", async () => {
      corruptPlaylist = true;
      // 切走再返回，保证触发新的媒体加载。
      await page.getByRole("navigation").getByRole("button", { name: /首页/ }).click();
      await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
      await page.getByRole("button", { name: "重新加载", exact: true }).waitFor({ timeout: 15000 });
      corruptPlaylist = false;
      await page.getByRole("button", { name: "重新加载", exact: true }).click();
      await expectTime(6);
    });
    await run("录像分组搜索、排序和快捷键切换真实选择", async () => {
      await page.evaluate(() => {
        const source = structuredClone(window.__REPLAY_TEST__.fixture);
        source.pullId = "0000000000000000000000000000000000000000000000000000000000000002";
        source.encounterName = "第二首领";
        source.encounterId += 1;
        source.encounterStartUnixMs += 60000;
        source.encounterEndUnixMs += 60000;
        window.__REPLAY_TEST__.extraRecordings = [source];
      });
      await refresh();
      await page.locator(".replay-encounter").filter({ hasText: "第二首领" }).locator(".replay-pull").click();
      await page.waitForFunction(() => document.querySelector(".replay-header-title strong").textContent === "第二首领");
      await page.locator(".replay-header-title").click(); await page.keyboard.press("q");
      await page.waitForFunction(() => document.querySelector(".replay-header-title strong").textContent === "媒体验证");
      await page.keyboard.press("e");
      await page.waitForFunction(() => document.querySelector(".replay-header-title strong").textContent === "第二首领");
      const search = page.getByRole("textbox", { name: "搜索本地录像" });
      await search.fill("不存在的首领");
      assert.equal(await page.locator(".replay-pull").count(), 0);
      await search.fill("q");
      assert.equal(await page.locator(".replay-header-title strong").textContent(), "第二首领");
      await search.fill("");
      await page.getByRole("button", { name: "切换录像时间排序" }).click();
      assert.match(await page.locator(".replay-encounter").first().textContent(), /媒体验证/);
      await page.locator(".replay-encounter").filter({ hasText: "媒体验证" }).locator(".replay-pull").click();
      await expectTime(6);
    });
    await run("工作台全屏及输入框不触发全屏快捷键", async () => {
      const search = page.getByRole("textbox", { name: "搜索本地录像" });
      await search.fill(""); await search.press("t");
      assert.equal(await page.evaluate(() => document.fullscreenElement === null), true);
      await search.fill("");
      await page.getByRole("button", { name: "切换复盘全屏" }).click();
      await page.waitForFunction(() => document.fullscreenElement?.classList.contains("replay-workspace"));
      await page.locator(".replay-header-title").click(); await page.keyboard.press("t");
      await page.waitForFunction(() => !document.fullscreenElement);
    });
    await run("轨高图标缩放持久恢复与横向浏览", async () => {
      await page.getByRole("button", { name: "设置时间轴外观" }).click();
      const height = page.getByRole("spinbutton", { name: "时间轴轨道高度" });
      await height.fill("50"); await height.press("Tab");
      const icon = page.locator("#replay-icon-size [role='slider']");
      await icon.focus(); await icon.press("End");
      await page.getByText("战斗时间轴", { exact: true }).click();
      assert.equal(await page.locator(".replay-timeline-track").first().evaluate((node) => node.getBoundingClientRect().height), 50);
      assert.equal(await page.getByRole("button", { name: /圣盾术 施法成功/ }).evaluate((node) => node.getBoundingClientRect().width), 50);
      await page.getByRole("button", { name: "放大战斗时间轴" }).click();
      assert.equal(await page.locator(".replay-axis-scroll").evaluate((node) => node.scrollWidth > node.clientWidth), true);
      await page.locator(".replay-axis-scroll").evaluate((node) => { node.scrollLeft = node.scrollWidth; });
      await page.waitForFunction(() => window.__REPLAY_TEST__.preferences.timelineZoom === 1.5);
      await page.getByRole("navigation").getByRole("button", { name: /首页/ }).click();
      assert.equal(await page.locator(".replay-shell").count(), 0);
      await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
      await expectTime(6);
      assert.equal(await page.locator(".replay-timeline-track").first().evaluate((node) => node.getBoundingClientRect().height), 50);
      assert.equal(await page.locator(".replay-axis-scroll").evaluate((node) => node.scrollWidth > node.clientWidth), true);
      await page.getByRole("button", { name: "设置时间轴外观" }).click();
      await page.getByRole("button", { name: "恢复默认外观" }).click();
      await page.getByText("战斗时间轴", { exact: true }).click();
      assert.equal(await page.locator(".replay-timeline-track").first().evaluate((node) => node.getBoundingClientRect().height), 30);
    });
    await run("空路径不启导入、原生选择多日志、真实进度完成刷新", async () => {
      await page.getByRole("button", { name: "导入录像", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "开始导入", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "选择导入录像目录" }).click();
      await page.getByRole("button", { name: "选择日志文件" }).click();
      assert.equal(await page.getByRole("textbox", { name: "待导入录像目录" }).inputValue(), "C:/fixtures/recordings");
      const before = await page.evaluate(() => window.__REPLAY_TEST__.listCalls);
      await page.getByRole("button", { name: "开始导入", exact: true }).click();
      await page.getByText("录像已加入本地列表", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__REPLAY_TEST__.importPreferences.logPaths.length), 2);
      assert.ok(await page.evaluate(() => window.__REPLAY_TEST__.listCalls) > before);
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
    });
    await run("导入任务跨页继续、取消及偏好恢复", async () => {
      await page.evaluate(() => { window.__REPLAY_TEST__.importAutoComplete = false; });
      await page.getByRole("button", { name: "导入录像", exact: true }).click();
      assert.equal(await page.getByRole("textbox", { name: "待导入录像目录" }).inputValue(), "C:/fixtures/recordings");
      await page.getByRole("button", { name: "开始导入", exact: true }).click();
      await page.getByRole("button", { name: "取消导入", exact: true }).waitFor();
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
      await page.getByRole("navigation").getByRole("button", { name: /首页/ }).click();
      await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
      await page.getByRole("button", { name: "导入录像", exact: true }).click();
      await page.getByRole("button", { name: "取消导入", exact: true }).click();
      await page.getByText("已取消导入", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__REPLAY_TEST__.importStarts), 2);
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
    });
    await run("导入失败可见且允许修正重试", async () => {
      await page.evaluate(() => { window.__REPLAY_TEST__.failImportStart = true; });
      await page.getByRole("button", { name: "导入录像", exact: true }).click();
      await page.getByRole("button", { name: "开始导入", exact: true }).click();
      await page.getByText("录像导入暂不可用", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "开始导入", exact: true }).isEnabled(), true);
      await page.evaluate(() => { window.__REPLAY_TEST__.failImportStart = false; window.__REPLAY_TEST__.importAutoComplete = true; });
      await page.getByRole("button", { name: "开始导入", exact: true }).click();
      await page.getByText("录像已加入本地列表", { exact: true }).waitFor();
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
    });
    await run("明确同场多视角按独立偏移保留战斗点和播放参数", async () => {
      await page.evaluate(() => {
        const state = window.__REPLAY_TEST__;
        state.fixture.battleKey = "fixture-report:1";
        state.fixture.recordingPlayerGuid = "Player-1";
        state.fixture.players = [{ guid: "Player-1", name: "测试角色" }, { guid: "Player-2", name: "测试队友" }, { guid: "Player-3", name: "无覆盖观察者" }];
        const next = structuredClone(state.fixture);
        next.pullId = "0000000000000000000000000000000000000000000000000000000000000003";
        next.playerName = "测试队友"; next.recordingPlayerGuid = "Player-2"; next.importedSource = "fixture-second-observer";
        next.mapping.videoZeroMs += 800;
        for (const interval of next.mapping.intervals) { interval.videoStartMs += 800; interval.videoEndMs += 800; }
        const unavailable = structuredClone(next);
        unavailable.pullId = "0000000000000000000000000000000000000000000000000000000000000004";
        unavailable.playerName = "无覆盖观察者"; unavailable.recordingPlayerGuid = "Player-3";
        unavailable.mapping.hasGap = true;
        unavailable.mapping.intervals = [{ pullStartMs: 0, pullEndMs: 3000, videoStartMs: 0, videoEndMs: 3000 }];
        state.extraRecordings.push(next, unavailable);
      });
      await refresh(); await seek(6); await expectTime(6);
      const originalTime = await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime);
      await page.getByRole("button", { name: "观看测试队友视角", exact: true }).click();
      await page.waitForFunction((target) => {
        const video = document.querySelector('video[aria-label$="本地回放"]');
        return video && video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target) < 0.15;
      }, originalTime + 0.8);
      assert.deepEqual(await page.locator("video[aria-label$='本地回放']").evaluate((video) => [video.volume, video.playbackRate, video.paused]), [0.4, 1.5, true]);
      assert.equal(await page.locator(".replay-pull").count(), 2);
      await page.getByRole("button", { name: "观看无覆盖观察者视角", exact: true }).click();
      await page.getByText("该人物的录像尚不可播放或不覆盖当前战斗时间，已保留当前视角。", { exact: true }).waitFor();
      assert.match(await page.locator(".replay-header-title").textContent(), /测试队友/);
      await page.getByRole("button", { name: "观看测试角色视角", exact: true }).click();
      await expectTime(6);
      await page.locator("media-play-button").click();
      await page.waitForFunction(() => !document.querySelector('video[aria-label$="本地回放"]').paused);
      await page.getByRole("button", { name: "观看测试队友视角", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".replay-header-title").textContent.includes("测试队友") && !document.querySelector('video[aria-label$="本地回放"]').paused);
      await page.locator("media-play-button").click();
      assert.equal(await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.paused), true);
      await page.getByRole("button", { name: "观看测试角色视角", exact: true }).click();
    });
    await run("真实拖技能换轨不改时间、回看定位及跨页布局恢复", async () => {
      await seek(6); await expectTime(6);
      const originalEvents = await page.evaluate(() => JSON.stringify(window.__REPLAY_TEST__.fixture.timelineEvents));
      const videoBefore = await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime);
      await page.getByRole("button", { name: /圣盾术 施法成功.*等 2 个事件/ }).dragTo(page.getByRole("slider", { name: "跳转到团队技能时间" }));
      const moved = page.locator('[data-replay-track="team"] button[draggable="true"]').filter({ has: page.locator('img[alt="圣盾术"]') });
      await moved.waitFor();
      assert.equal(await page.evaluate(() => JSON.stringify(window.__REPLAY_TEST__.fixture.timelineEvents)), originalEvents);
      assert.ok(Math.abs(await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime) - videoBefore) < 0.15);
      await moved.click(); await expectTime(3);
      await page.getByText("战斗时间轴", { exact: true }).click();
      await page.waitForFunction(() => window.__REPLAY_TEST__.preferences.timelineTrackOverrides["player:642:castSuccess:Player-1"] === "team");
      await page.getByRole("navigation").getByRole("button", { name: /首页/ }).click();
      await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
      await expectTime(3); await moved.waitFor();
      await page.getByRole("button", { name: "轨道布局", exact: true }).click();
      await page.getByRole("button", { name: "恢复默认轨道布局", exact: true }).click();
      await page.getByText("战斗时间轴", { exact: true }).click();
      await page.getByRole("button", { name: /圣盾术 施法成功.*等 2 个事件/ }).waitFor();
    });
    await run("个人轨道新增改名拖入清除删除，事件与定位保持原样", async () => {
      const originalEvents = await page.evaluate(() => JSON.stringify(window.__REPLAY_TEST__.fixture.timelineEvents));
      const beforeTime = await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime);
      await page.getByRole("button", { name: "轨道布局", exact: true }).click();
      await page.getByRole("textbox", { name: "新增个人轨道名称", exact: true }).fill("个人复盘");
      await page.getByRole("button", { name: "新增个人轨道", exact: true }).click();
      await page.getByText("战斗时间轴", { exact: true }).click();
      const target = page.getByRole("slider", { name: "跳转到个人复盘时间", exact: true });
      await target.waitFor();
      const id = await target.locator("..").getAttribute("data-replay-track");
      assert.match(id, /^custom-[0-9a-f-]{36}$/);
      await page.getByRole("button", { name: /圣盾术 施法成功.*等 2 个事件/ }).dragTo(target);
      const moved = page.locator(`[data-replay-track="${id}"] button[draggable="true"]`);
      await moved.waitFor();
      assert.ok(Math.abs(await page.locator("video[aria-label$='本地回放']").evaluate((video) => video.currentTime) - beforeTime) < 0.15);
      await moved.click(); await expectTime(3);
      await page.getByText("战斗时间轴", { exact: true }).click();
      await page.getByRole("button", { name: "轨道布局", exact: true }).click();
      await page.getByRole("textbox", { name: "轨道名称 个人复盘", exact: true }).fill("关键时刻");
      await page.getByRole("button", { name: "保存个人复盘轨道名称", exact: true }).click();
      await page.getByText("战斗时间轴", { exact: true }).click();
      await page.getByRole("slider", { name: "跳转到关键时刻时间", exact: true }).waitFor();
      await page.waitForFunction((expected) => window.__REPLAY_TEST__.preferences.customTimelineTracks?.[0]?.id === expected && window.__REPLAY_TEST__.preferences.customTimelineTracks[0].name === "关键时刻", id);
      await page.getByRole("navigation").getByRole("button", { name: /首页/ }).click();
      await page.getByRole("navigation").getByRole("button", { name: /回放/ }).click();
      await expectTime(3); await moved.waitFor();
      await page.getByRole("button", { name: "轨道布局", exact: true }).click();
      await page.getByRole("button", { name: "清除关键时刻轨道覆盖", exact: true }).click();
      await page.getByText("战斗时间轴", { exact: true }).click();
      await page.getByRole("button", { name: /圣盾术 施法成功.*等 2 个事件/ }).dragTo(page.getByRole("slider", { name: "跳转到关键时刻时间", exact: true }));
      await moved.waitFor();
      await page.getByRole("button", { name: "轨道布局", exact: true }).click();
      await page.getByRole("button", { name: "删除关键时刻轨道", exact: true }).click();
      await page.getByText("战斗时间轴", { exact: true }).click();
      assert.equal(await page.getByRole("slider", { name: "跳转到关键时刻时间", exact: true }).count(), 0);
      await page.getByRole("button", { name: /圣盾术 施法成功.*等 2 个事件/ }).waitFor();
      await expectTime(3);
      assert.equal(await page.evaluate(() => JSON.stringify(window.__REPLAY_TEST__.fixture.timelineEvents)), originalEvents);
    });
    await run("放大并横向滚动后仍按完整战斗轴定位", async () => {
      await page.getByRole("button", { name: "放大战斗时间轴" }).click();
      const target = await axis().evaluate((node) => {
        const scroll = node.closest(".replay-axis-scroll");
        scroll.scrollLeft = scroll.scrollWidth;
        const bounds = node.getBoundingClientRect();
        return { x: bounds.x + bounds.width * 0.8, y: bounds.y + bounds.height / 2 };
      });
      await page.mouse.click(target.x, target.y); await expectTime(8);
      assert.ok(await axis().evaluate((node) => Math.abs(Number(node.getAttribute("aria-valuenow")) - 8) < 0.15));
      await page.getByRole("button", { name: "缩小战斗时间轴" }).click();
    });
    await run("光环刷新蓄力与复活独立筛选，等级提示及点击回看保持真实媒体定位", async () => {
      await verifyExtendedEvents({ page, refresh, expectTime, fixture });
    });
    await run("桌面及最小窗口布局无横向溢出", async () => {
      for (const [width, height, name] of [[1440, 900, "desktop"], [1080, 720, "minimum"]]) {
        await page.setViewportSize({ width, height });
        await page.getByText("战斗时间轴", { exact: true }).scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator("main").evaluate((node) => node.scrollWidth <= node.clientWidth), true);
        await page.screenshot({ path: path.join(outputRoot, `${name}.png`), fullPage: true });
      }
    });
    assert.deepEqual(report.pageErrors, []);
    report.browser = browser.version();
    report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = String(error.stack || error);
    await page.screenshot({ path: path.join(outputRoot, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
    await browser.close(); await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
