import { ConfigProvider, theme } from "antd";
import { HomePage } from "../pages/home/HomePage";

/** 配置桌面端统一主题并挂载当前首页。 */
export function App() {
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
      <HomePage />
    </ConfigProvider>
  );
}
