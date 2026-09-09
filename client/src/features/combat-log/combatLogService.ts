import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { CombatLogStatus } from "@/features/combat-log/model";
import { emptyCombatLogStatus } from "@/features/combat-log/model";

const isTauri = () => "__TAURI_INTERNALS__" in window;

/** 统一封装 CombatLog 路径与监控设置命令。 */
export const combatLogService = {
  async status(): Promise<CombatLogStatus> {
    return isTauri() ? invoke("get_combat_log_status") : emptyCombatLogStatus;
  },
  async chooseDirectory(current: string | null): Promise<string | null> {
    if (!isTauri()) return null;
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择正式服 CombatLog 目录",
      defaultPath: current ?? undefined,
    });
    return typeof selected === "string" ? selected : null;
  },
  async setDirectory(directory: string): Promise<CombatLogStatus> {
    return invoke("set_combat_log_directory", { directory });
  },
  async setMonitoring(monitoring: boolean): Promise<CombatLogStatus> {
    return invoke("set_combat_log_monitoring", { monitoring });
  },
};
