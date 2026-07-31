# WoW Recorder

## Windows 客户端打包

前置环境：Node.js、Rustup 和 Visual Studio C++ 桌面开发工具。

```powershell
cd client
.\package.ps1
```

脚本不需要参数，会安装锁定的前端依赖并生成 NSIS 安装包。产物位于
`client/src-tauri/target/release/bundle/nsis/`。
