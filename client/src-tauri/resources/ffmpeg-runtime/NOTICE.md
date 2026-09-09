# FFmpeg 运行时说明

本目录包含 WoW Recorder 用于本地 Boss 录像裁切的 FFmpeg Windows x64 LGPL shared 构建。

- FFmpeg 版本：`n8.1.2-50-g1a748fe2cd`
- 构建项目：BtbN/FFmpeg-Builds
- 发布标签：`autobuild-2026-09-04-14-01`
- 原始归档：`ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-shared-8.1.zip`
- 原始地址：`https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-04-14-01/ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-shared-8.1.zip`
- 归档 SHA-256：`d4a0db2e182e6d1535a022523d329daf8daff9d69db88d5aa569732005cffa91`

本项目只调用 `ffmpeg.exe` 执行已有 H.264/音频流的 stream copy，不链接 FFmpeg 库。上游许可证原文见同目录 `LICENSE.txt`。发布安装包时必须同时包含许可证、此说明、`ffmpeg.exe` 和它所需的共享库。
