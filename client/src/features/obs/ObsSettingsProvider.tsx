import { createContext, useContext } from "react";
import type { PropsWithChildren } from "react";
import { useObsSettingsController } from "@/features/obs/useObsSettings";

type ObsSettingsContextValue = ReturnType<typeof useObsSettingsController>;

const ObsSettingsContext = createContext<ObsSettingsContextValue | null>(null);

/** 在应用生命周期内保留唯一一份 OBS 设置和运行状态。 */
export function ObsSettingsProvider({ children }: PropsWithChildren) {
  const value = useObsSettingsController();
  return (
    <ObsSettingsContext.Provider value={value}>
      {children}
    </ObsSettingsContext.Provider>
  );
}

/** 读取应用级 OBS 状态，调用方必须位于 Provider 内。 */
export function useObsSettings(): ObsSettingsContextValue {
  const value = useContext(ObsSettingsContext);
  if (!value) {
    throw new Error("OBS 设置状态缺少应用级 Provider");
  }
  return value;
}
