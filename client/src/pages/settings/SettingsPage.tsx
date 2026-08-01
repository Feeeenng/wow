import { useState } from "react";
import { CombatLogSettings } from "@/features/combat-log/CombatLogSettings";
import { ObsSettingsPanel } from "@/features/obs/ObsSettingsPanel";
import { SettingsPlaceholder } from "@/pages/settings/SettingsPlaceholder";
import { settingsNavigation } from "@/pages/settings/settingsNavigation";
import type { SettingsSection } from "@/pages/settings/settingsNavigation";

const placeholderTitles: Partial<Record<SettingsSection, string>> = {
  general: "常规设置",
  game: "游戏路径",
  storage: "上传与存储",
  updates: "通知与更新",
};

/** 组合设置二级导航及各业务设置面板。 */
export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("obs");

  let content = <ObsSettingsPanel />;
  if (activeSection === "combat-log") {
    content = <CombatLogSettings />;
  } else if (placeholderTitles[activeSection]) {
    content = <SettingsPlaceholder title={placeholderTitles[activeSection]!} />;
  }

  return (
    <div className="grid grid-cols-[196px_minmax(0,1fr)] gap-4">
      <aside className="self-start rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-2">
        {settingsNavigation.map(({ key, label, icon: Icon }) => {
          const active = key === activeSection;
          return (
            <button
              key={key}
              type="button"
              className={`flex h-11 w-full items-center gap-3 rounded px-3 text-sm ${
                active
                  ? "bg-[color-mix(in_srgb,var(--app-primary)_10%,white)] font-medium text-[var(--app-primary)]"
                  : "text-[var(--app-text-secondary)] hover:bg-gray-50 hover:text-[var(--app-text)]"
              }`}
              onClick={() => setActiveSection(key)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          );
        })}
      </aside>
      <div className="min-w-0">{content}</div>
    </div>
  );
}
