import { useCallback, useEffect, useState } from "react";
import { combatLogService } from "@/features/combat-log/combatLogService";
import type { CombatLogStatus } from "@/features/combat-log/model";
import { emptyCombatLogStatus } from "@/features/combat-log/model";

/** 维护设置页所需的 CombatLog 状态和用户操作。 */
export function useCombatLogSettings() {
  const [status, setStatus] = useState<CombatLogStatus>(emptyCombatLogStatus);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await combatLogService.status());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const chooseDirectory = async () => {
    const directory = await combatLogService.chooseDirectory(status.directory);
    if (!directory) return;
    try {
      setLoading(true);
      setStatus(await combatLogService.setDirectory(directory));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const setMonitoring = async (monitoring: boolean) => {
    try {
      setLoading(true);
      setStatus(await combatLogService.setMonitoring(monitoring));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  return { status, loading, error, refresh, chooseDirectory, setMonitoring };
}
