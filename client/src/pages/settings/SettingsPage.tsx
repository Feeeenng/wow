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
    <div className="space-y-4">
      <nav
        aria-label="设置分类"
        className="overflow-x-auto rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-2"
      >
        <div className="flex min-w-max items-center gap-1">
          {settingsNavigation.map(({ key, label, icon: Icon }) => {
            const active = key === activeSection;
            return (
              <button
                key={key}
                type="button"
                className={`flex h-10 min-w-32 items-center justify-center gap-2 rounded px-4 text-sm ${
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
        </div>
      </nav>
      <div className="min-w-0">{content}</div>
    </div>
  );
}
