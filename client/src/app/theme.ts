import type { ThemeConfig } from "antd";

export type WowThemeName = "the-war-within" | "midnight";

interface WowThemePreset {
  primary: string;
  accent: string;
  liveAccent: string;
  background: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
}

const themePresets: Record<WowThemeName, WowThemePreset> = {
  "the-war-within": {
    primary: "#1677ff",
    accent: "#d97706",
    liveAccent: "#fa541c",
    background: "#f5f7fa",
    surface: "#ffffff",
    border: "#e5e7eb",
    text: "#1f2937",
    textSecondary: "#6b7280",
  },
  midnight: {
    primary: "#6d5bd0",
    accent: "#2f9eaa",
    liveAccent: "#eb2f96",
    background: "#f4f5f8",
    surface: "#ffffff",
    border: "#e1e3e8",
    text: "#20232a",
    textSecondary: "#69707d",
  },
};

export const activeWowTheme: WowThemeName = "the-war-within";

/** 将版本主题同步到 Ant Design Token 与全局 CSS 变量。 */
export function createAppTheme(name: WowThemeName): ThemeConfig {
  const preset = themePresets[name];
  const root = document.documentElement;
  root.style.setProperty("--app-primary", preset.primary);
  root.style.setProperty("--app-accent", preset.accent);
  root.style.setProperty("--app-live-accent", preset.liveAccent);
  root.style.setProperty("--app-bg", preset.background);
  root.style.setProperty("--app-surface", preset.surface);
  root.style.setProperty("--app-border", preset.border);
  root.style.setProperty("--app-text", preset.text);
  root.style.setProperty("--app-text-secondary", preset.textSecondary);

  return {
    token: {
      colorPrimary: preset.primary,
      colorInfo: preset.primary,
      colorBgLayout: preset.background,
      colorBgContainer: preset.surface,
      colorBorder: preset.border,
      colorText: preset.text,
      colorTextSecondary: preset.textSecondary,
      borderRadius: 6,
      fontFamily: 'Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
    },
    components: {
      Card: {
        headerBg: preset.surface,
      },
      Layout: {
        bodyBg: preset.background,
        siderBg: preset.surface,
      },
    },
  };
}
