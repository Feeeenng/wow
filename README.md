# WoW Recorder

## Windows 客户端开发启动

前置环境：Node.js、Rustup 和 Visual Studio C++ 桌面开发工具。

日常启动客户端只需在仓库根目录执行：

```powershell
cd client
npm run tauri dev
```

仅在首次克隆仓库或前端依赖发生变化且尚未安装时，先执行：

```powershell
cd client
npm ci
```

该命令会同时启动 Vite 开发服务、编译 Rust 后端并打开 Tauri 客户端窗口。命令运行期间不要关闭当前终端；按 `Ctrl+C` 停止开发客户端。

## Windows 客户端打包

前置环境：Node.js、Rustup 和 Visual Studio C++ 桌面开发工具。

```powershell
cd client
.\package.ps1
```

脚本不需要参数，会安装锁定的前端依赖并生成 NSIS 安装包。产物位于
`client/src-tauri/target/release/bundle/nsis/`。
