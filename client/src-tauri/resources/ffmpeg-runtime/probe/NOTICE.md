# 媒体探测运行时说明

本目录用于隔离运行 ffprobe，不替换父目录的录制 FFmpeg 或共享库。

- 构建版本：`N-127021-ge0c94b2d1c-20260930`。
- 来源：BtbN/FFmpeg-Builds，`autobuild-2026-09-30-13-08` 月度构建。
- 用户提供归档：`ffmpeg-N-127021-ge0c94b2d1c-win64-lgpl-shared.zip`。
- 归档 SHA-256：`2cc3dd0baf74ebd68a3fceaf771df8351a7a6d69694d05f43b16bb0c966ec909`，与 GitHub 官方资产 `600949981` 的摘要相符。
- 原始下载：https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-N-127021-ge0c94b2d1c-win64-lgpl-shared.zip

仅提取 ffprobe、通过 PE 导入表确认的配套 DLL 和许可证。逐文件摘要及依赖记录位于 `manifest.json`，Windows 打包脚本在构建前校验。应用通过命令行读取 JSON，不链接这些库；分发时同时保留本说明和 `LICENSE.txt`。
