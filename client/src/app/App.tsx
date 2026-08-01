import { ConfigProvider, theme } from "antd";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ObsControlWindow } from "@/features/obs/ObsControlWindow";
import { HomePage } from "@/pages/home/HomePage";

/** 配置桌面端统一主题并挂载当前首页。 */
export function App() {
  const isObsWindow =
    getCurrentWindow().label === "obs-control" ||
    new URLSearchParams(window.location.search).get("window") === "obs";

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#f28c28",
          colorBgBase: "#0b0e12",
          colorTextBase: "#edf1f5",
          colorBorder: "#30363f",
          borderRadius: 6,
          fontFamily:
            'Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
        },
      }}
    >
      {isObsWindow ? <ObsControlWindow /> : <HomePage />}
    </ConfigProvider>
  );
}
