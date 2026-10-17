import { theme } from "antd";
import type { ThemeConfig } from "antd";

/** 复盘工作台局部主题，与 replay.css 的工作台调色保持一致，不修改设置页面。 */
export const replayTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#e51039",
    colorInfo: "#e51039",
    colorBgContainer: "#141a20",
    colorBgElevated: "#19212c",
    colorBorder: "#303946",
    colorText: "#edf0f4",
    colorTextSecondary: "#9ca7b5",
    borderRadius: 4,
    controlHeight: 28,
    fontSize: 12,
  },
};
