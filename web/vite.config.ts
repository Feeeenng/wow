import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

const notice = () => readFileSync(fileURLToPath(new URL("../client/src-tauri/resources/game-data/NOTICE.md", import.meta.url)), "utf8");
// 开发与静态预览都使用同源API代理；部署时由站点反向代理承担此路径。
const apiProxy = { "/api": { target: process.env.WOW_API_TARGET || "http://127.0.0.1:8000", changeOrigin: true } };

export default defineConfig({
  plugins: [react(), {
    name: "game-data-notice",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/game-data-NOTICE.txt") { next(); return; }
        response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.end(notice());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "game-data-NOTICE.txt",
        source: notice() });
    },
  }],
  resolve: { dedupe: ["react", "react-dom", "antd"], alias: {
    "@/shared": fileURLToPath(new URL("../shared", import.meta.url)),
    "@/spell-pack": fileURLToPath(new URL("../client/src-tauri/resources/game-data/spells.json", import.meta.url)),
    "@/spell-icons": fileURLToPath(new URL("../client/src-tauri/resources/game-data/icons", import.meta.url)),
    "@": fileURLToPath(new URL("./src", import.meta.url)),
  } },
  server: { host: "127.0.0.1", port: 1421, strictPort: true,
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../shared", import.meta.url)),
      fileURLToPath(new URL("../client/src-tauri/resources/game-data", import.meta.url))] },
    proxy: apiProxy,
  },
  preview: { host: "127.0.0.1", port: 1421, strictPort: true, proxy: apiProxy },
  build: { assetsInlineLimit: 0 },
});
