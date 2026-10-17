/** 仅浏览器回归使用的明确IPC边界，原生验收不装载此适配器。 */
exports.installReplayFixture = async ({ page, fixture, spells, defaults }) => {
  await page.addInitScript(({ fixture, spells, defaults }) => {
    const state = window.__REPLAY_TEST__ = {
      fixture, metadataCalls: 0, listCalls: 0, imports: 0, retries: 0, failSave: false,
      extraRecordings: [],
      importPreferences: { directory: "", logPaths: [] }, importStarts: 0, importPolls: 0, importAutoComplete: true, failImportStart: false,
      importProgress: { taskId: null, status: "idle", totalRecordings: 0, processedRecordings: 0, importedCount: 0, skippedCount: 0, failedCount: 0, bytesRead: 0, totalBytes: 0, currentFile: null, error: null, issues: [], pullIds: [] },
      preferences: { selectedPullId: fixture.pullId, bookmarksMs: {}, offsetsMs: {}, volume: 1, muted: false, playbackRate: 1, eventKinds: [], actorGuid: null },
    };
    let callback = 0;
    const callbacks = new Map(), listeners = new Map();
    state.closeCount = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_, id) => { const listener = listeners.get(id); if (listener) callbacks.delete(listener.handler); listeners.delete(id); } };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: (handler) => { const id = ++callback; callbacks.set(id, handler); return id; },
      unregisterCallback: (id) => callbacks.delete(id),
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
        if (command === "plugin:event|listen") { const id = ++callback; listeners.set(id, args); return id; }
        if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
        if (command === "plugin:window|close") {
          const closing = [...listeners.entries()].filter(([, value]) => value.event === "tauri://close-requested");
          if (!closing.length) { state.closeCount++; state.closeSnapshot = structuredClone(state.preferences); return; }
          for (const [id, value] of closing) await callbacks.get(value.handler)?.({ event: value.event, id, payload: null });
          return;
        }
        if (command === "plugin:window|is_maximized") return false;
        return null;
      },
    };
  }, { fixture, spells, defaults: { disconnectedObsStatus: defaults.disconnectedObsStatus, defaultInstallationStatus: defaults.defaultInstallationStatus } });
};
