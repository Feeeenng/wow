# 云端客户端上传实现与验证（2026-10-17）

事件v3阶段新增刷新／蓄力／复活及本地媒体锁竞争修复，当时完整Rust115通过。其后共享校准阶段已更新为完整Rust117、后端全服务115及共享原生9项通过，见[共享校准报告](shared-calibration-validation-2026-10-17.md)。下文产物表保留历史，当前安装包以[阶段总表](replay-final-acceptance-2026-10-17.md)为准。

## 当前结果

已实现 Rust 云端连接、凭证保护、持久上传意图、顺序 Multipart 上传、恢复、暂停、取消和显式重试，以及前端应用级 Provider。所有上传由用户按本地 Pull ID 明确发起，不扫描历史录像自动外发，不上传原始 CombatLog。

本报告的验证覆盖 Windows DPAPI、本机 HTTP 协议夹具、队列持久化与错误边界；另已通过真实 FastAPI、PostgreSQL、私有 MinIO、Redis、独立 Celery worker 与 beat 的原生媒体闭环。真实服务验收仅使用合成 MP4 和随机隔离数据，不涉及用户录像或正式应用数据；线上部署和真实 WCL 凭证仍需单独验收。

## 实现与数据边界

- `client/src-tauri/src/cloud/auth/`：服务地址、个人 Bearer 令牌、团队验证及当前身份。仅允许 HTTPS 或明确配置的回环 HTTP，拒绝地址内账号、密码、查询参数。前端读取接口不返回明文令牌或密文。
- `cloud/api/`：固定 `/api/v1` 协议与严格 camelCase DTO。元数据只发送稳定 Pull ID、人物、战斗、时间映射及质量、媒体大小和摘要，不发送本机视频路径、日志路径、源分片路径或日志原文。
- `cloud/upload/`：从录制索引取已完成 MP4，单队列顺序上传，按服务器分片大小及真实确认结果恢复。原 MP4 始终只读，外部导入原片同样不移动、不覆盖。
- `client/src/features/cloud/`：类型、Tauri 服务和跨页面 Provider。React 不保存令牌或业务队列，不使用浏览器持久化。

凭证使用当前 Windows 登录用户的 DPAPI 保护，仅把密文保存在 Rust `LocalStateStore` 的 `cloud` 区段。DPAPI 的用户/设备边界及系统输出释放方式参照微软官方 [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) 和 [CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata) 文档。换服务器且未提交新令牌时清除旧凭证和身份；同服务留空令牌表示保留已有凭证，提交空服务地址表示断开并清除凭证。

云区段损坏不会阻止本地录制客户端启动。该情况下云功能显示恢复错误，保留原始区段，阻止后台上传和空状态覆盖；目前需要恢复配置后重新启动云功能，没有自动重置损坏区段。

## 上传、恢复与取消

每个任务绑定首次授权的服务地址、用户、团队、设备和 Pull ID。首次登记前流式计算完整 SHA-256，使用其作为 `artifactVersion`。上传前校验索引成片状态、观看者 GUID、文件大小和完整摘要；分片读取时再次累计完整摘要，合并前检查摘要和文件修改状态，避免传输期间原片变化却错误提交完成。

`cloudUploads` 只持久化用户意图、登记元数据及服务器上传身份，不持久化“连接在线”“正在上传”或已传字节作为启动真值。重启后先查询服务器状态，并对服务器确认分片重新比对本地分片摘要。已上传或暂停的服务器会话也定期核验，云端处理就绪不会永远停留在旧显示快照。

服务端给出分片大小，客户端限制最大 64MiB、最多 10,000 片。API 使用十六进制 SHA-256；S3 请求头使用原始摘要字节的 Base64。预签名上传使用独立 HTTP 请求，不携带 API Bearer，不跟随重定向；错误输出移除 URL，避免泄露签名查询参数。Multipart ETag 不作为完整文件 MD5 或 SHA-256。

暂停/取消先保存意图，再中止当前分片 HTTP 请求。S3 可能已接收但客户端未确认的分片由后续服务器状态恢复。显式重试已中止的未完成任务时调用后端 `restart`；普通恢复不会主动丢弃既有分片。整个文件已经上传后，不将取消操作当作云端文件删除。

本地“上传完成”只代表服务器确认文件上传，不代表云端转码、WCL 导入或媒体发布完成。界面保留服务器 `recordingStatus`、`verification` 和 `fullFileSha256Verified`；`partsVerified` 不冒充完整文件已由服务器重算校验，也不冒充可播放。

## 实际验证

执行命令：

```powershell
cd client/src-tauri
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --lib cloud:: -- --nocapture
```

最近一次云域定向结果：20 项通过、0 失败、0 忽略、86 项被筛除，退出码 0；测试耗时 2.06 秒，编译耗时 14.95 秒，包含主线云端回放及 WCL 协议边界测试。新增的 opaque `connectionKey` 在令牌轮换时变化，前端据此丢弃旧目录缓存；该字段不暴露令牌或密文。上传 DTO 另保留真实 `hasGap`、`success` 和 `groupSize`，未知缺口区间不能被默认为连续画面。此数目对应当时快照，后续画笔／自定义轨道的新测试由最终全量回归另行记录。

| 验证方面 | 证据 |
|---|---|
| DPAPI | 真实 Windows 加解密往返；密文不含输入明文；损坏密文拒绝 |
| 地址与身份 | 远程 HTTP、地址凭证和服务地址查询拒绝；换地址清旧令牌；同服务换团队重新鉴权 |
| 异步竞态 | 阻塞旧 `/me`，保存新服务与新令牌后释放旧响应；旧验证不能覆盖新身份 |
| 持久队列 | 写失败不发布内存；修复目录后可重试；保留其他业务区段 |
| 启动恢复 | 恢复用户意图，身份、活跃请求和进度保持未核验；损坏区段不覆盖 |
| Multipart 协议 | 本机 HTTP 夹具模拟分片已被接收但确认失败；重新读取服务器状态后不重复 PUT 已确认分片 |
| 凭证隔离 | API 请求带夹具 Bearer，预签名 PUT 无 Bearer；签名 URL 错误不泄露查询参数 |
| 文件完整性 | 公开 DTO 不含本机路径和日志；文件摘要变化时拒绝云端合并 |
| 暂停、取消、重试 | 持久意图、中止当前请求、显式重启标记与任务状态验证 |
| 状态核验调度 | 显式工作优先，未核验任务不被周期状态刷新饿死 |

一次扩展到 15 项的测试曾出现 14 通过、1 失败：Windows HTTP 夹具接收套接字继承非阻塞标志，读取请求时触发 `WouldBlock`。已在夹具中显式恢复阻塞读取；随后相同定向命令依次得到 17 项及上方扩展测试通过结果。该失败发生在测试夹具，未通过放宽生产校验绕过。

前端 Provider 已处理变更与旧轮询响应竞态：等待旧查询退出再读取变更后的状态，配置动作串行；普通刷新失败在 Provider 内显示错误，不产生无人处理的 Promise。

## 原生团队播放验收

新增 `client/tests/native-cloud-replay.cjs`，强制使用 `com.wow.recorder.cloudvalidation20261017` 独立应用标识和固定合成媒体夹具，真实 Rust IPC、DPAPI、WebView2 与 `cloud-replay` 协议均未替换。云端 HTTP 服务由本机测试进程提供，未连接真实 S3/数据库，未调用真实录像上传。

前端 `npm run build` 退出码 0，4925 模块构建成功，仅保留既有大 chunk 警告。独立配置的 `tauri build --debug --no-bundle` 退出码 0，Rust 编译约 29.97 秒，保留既有 `diagnostics` 未使用提示；未执行 NSIS，也未恢复默认标识构建。

原生脚本执行退出码 0，8 项通过，页面异常 0，耗时约 8.18 秒。共 32 次本机 HTTP 请求，其中 23 次媒体请求，全部有正确 Bearer：

1. 原生配置与实际 `/me` 身份、个人中心展示、DPAPI 密文落盘、读取不返回令牌。
2. 真实目录规范化，两视角不同 `videoZeroMs`，处理中项无播放 URL，未知缺口保留 `hasGap=true` 和空区间。
3. 团队界面真实 HLS 播放，暂停切换视角保持战斗时间，缺片视角点击后保留旧画面。
4. 播放中切换视角保持播放意图并继续推进。
5. 协议拒绝外链清单、跨路径 URI、非法 ID 和多余查询；非法本地 URL 不向 HTTP 服务转发。
6. 同服务令牌轮换后旧媒体 URL 立即失效，无旧请求外发；刷新目录后新 URL 可播放。
7. 原生进程重启恢复密文配置，身份先为空，重新向服务器验证后可播放。
8. 切换团队或服务后旧媒体 URL 失效；换服务且无新令牌时清除旧凭证和身份。

首次原生执行在第 4 项发现只读 Tooltip 覆盖相邻 POV 按钮，普通点击等待 30 秒被拦截。UI 已将人物卡只读提示设为不拦截指针，重建后 8 项复验全部通过，使用普通点击，没有强制点击或额外移开鼠标规避。最终该次原生复验约 8.28 秒，页面异常 0。

临时证据位于 `%TEMP%\wow-replay-phase2-20261017\native-cloud`，包括 `report.json`、`native-team.png`、`native-team-1080.png`、独立构建配置和原生运行日志。截图已人工查看，1440×900 与 1080×720 下目录、播放器和时间轴均无横向溢出。

## 真实服务原生媒体闭环

新增 `client/tests/real-cloud-stack.py` 与 `client/tests/native-real-cloud.cjs`。控制器仅在内存读取临时私有配置，创建随机 PostgreSQL schema、私有 MinIO bucket、独立 Redis 队列和合成用户／团队；通过真实 API 和独立 Celery 处理媒体。原生脚本强制检查独立应用标识，只将固定合成 MP4 放入隔离应用索引，再通过正式 Tauri 上传命令发起传输，不修改上传队列文件绕过生产流程。

真实媒体闭环执行退出码 0，5 项通过、页面异常 0：

1. 真实账号和团队鉴权，DPAPI 密文保存，读取不返回明文令牌。
2. 约 13.6MB 合成 MP4 分成 3 片；首个 5MiB 分片确认后关闭原生进程，重启恢复原上传任务，首片未重复预签名或确认，全部分片真实进入 MinIO。
3. 第二路通过显式 `teamPullId` 加入同一团队战斗，两路均经独立 worker 完整 SHA-256 校验并发布 HLS；数据库处理任务均只执行 1 次。
4. 两路本地战斗起点相对共同零点分别为 +300ms、-200ms，响应视频零点分别为 1700ms、4200ms。战斗第 3 秒在真实 WebView2 分别定位到视频 4.7 秒、7.2 秒；视频 320×180，存在真实解码帧并保存合成器截图。
5. 数据库撤销成员后，旧媒体地址与目录读取被拒绝；两份本地合成源文件摘要不变。

首次执行使用网页 Canvas 读取跨源 MSE 视频像素，被浏览器安全策略拒绝；媒体上传、发布及定位已完成。验收改用 WebView2 合成器截图及真实解码帧计数，未放宽生产跨源策略；完整复验得到上述 5 项通过。临时证据位于 `%TEMP%\wow-replay-phase2-20261017\native-real-cloud`，包含 `report.json`、实际解码截图与不含凭证的服务日志。结束后仅清理本次 schema、bucket、队列和子进程，父任务提供的数据库、MinIO、Redis 服务保持运行。

## 真实任务链与受控 WCL 标准事件

`native-real-cloud.cjs --with-wcl` 在完整真实媒体闭环上增加 `wcl_protocol_fixture.py` 的本机 token／GraphQL 服务。WCL HTTP 响应来自固定合成公开报告；FastAPI、PostgreSQL、Redis、独立 Celery、Rust IPC 和 WebView2 均使用真实实现，未使用线上 WCL 凭证或调用真实 WCL 网站。

实际命令（工作目录 `client`；私有文件仅由控制器在内存读取，以下不包含任何凭证值）：

```powershell
node tests/native-real-cloud.cjs `
  --fixture "$env:TEMP\wow-replay-validation-20261017\browser" `
  --output "$env:TEMP\wow-replay-phase2-20261017\native-real-cloud-wcl" `
  --exe src-tauri/target/debug/wow-recorder-client.exe `
  --playwright C:/Users/Admin/AppData/Local/npm-cache/_npx/ad9a3fdbcad992c6/node_modules/playwright-core `
  --python ../backend/.venv/Scripts/python.exe `
  --private "$env:TEMP\wow-replay-phase2-20261017\cloud-stack\private.json" `
  --with-wcl
```

最新前端 `npm run build` 退出码 0，4939 模块构建成功；独立标识 `tauri build --debug --no-bundle` 退出码 0，编译 28.13 秒。原生真实闭环脚本退出码 0，9 项全部通过，页面异常 0。除再次验证上述真实媒体 5 项，还验证：

- 未显式导入前不请求 WCL。显式绑定两路视角 actor 后，独立 worker 跨越首个空事件页，按 `0 → 100 → 7500` 推进并发布完整 7 条标准事件；首条公共时间为 -400ms，环境来源 actor -1／0 被保留，未知 actor 类型可为空，GUID 不被伪造。
- 原生界面中两个同名玩家分别标为 `#1`、`#2`，筛选不会串人；负时间事件不夹到 0 秒。技能点击保留默认 3 秒前文，实际视频定位 4.7／5.2 秒；切换视角保持相同战斗时间并定位 7.2 秒。
- 受控分页不推进导致新导入失败时，旧完整快照及旧游标继续可读。随后导入报告版本 2 成功，新版本使旧游标返回重置，视频零点仍为 1700／4200ms，不被事件导入修改。
- 在真实数据库将当前用户降为普通成员后，标准事件导入被拒绝且不再发上游请求，已有标准事件仍可读；删除团队成员后，旧目录、媒体和事件均拒绝访问。

证据位于 `%TEMP%\wow-replay-phase2-20261017\native-real-cloud-wcl`，包含 `report.json`、`native-wcl-events.png`、`decoded-team-frame.png`。截图已人工查看，标准事件人物筛选、双视角画面和图标轨道显示正确；实际视频时间分别精确返回 4.7、7.2 秒，解码帧计数为 5。结束时 schema 删除、私有 bucket 删除和自建进程停止全部成功，清理错误为空。

随后针对新增个人轨道补充完整原生复验：同一命令将 `--output` 改为 `native-real-cloud-wcl-tracks`，`--exe` 指向上一轮固定的独立应用拷贝，其余参数不变。此次 10 项全部通过、退出码 0、页面异常 0。第 10 个覆盖点通过真实 IPC 保存 `custom-UUID` 轨道及带报告 actor 身份的 WCL 技能覆盖，关闭进程后重新启动，在真实团队界面看到圣盾术图标位于个人轨道；云端 7 条事件及原有 `owner=team` 保持不变。该轮清理同样全部成功，`native-wcl-personal-track.png` 已人工核对。

最终个人轨道复验进一步改为真实鼠标新增、拖入技能、关进程重启、删除回默认轨道，并再次点击技能确认实际视频定位 7.2 秒。完整 10 项仍全部通过、退出码 0、页面异常 0、清理全部成功。证据位于 `native-real-cloud-wcl-mouse`，报告包含 `personalTrackMouseLifecycle=true`，覆盖点不再仅依赖 IPC 设置。

## 画笔原生验证过程

扩展 `--with-annotations` 首次运行中，真实鼠标箭头、撤销重做、PostgreSQL 保存，以及并发 CAS 一次成功／一次 409 均已完成，但脚本快速切视角后立即关闭进程，回放源与选中 ID 的 500ms 偏好防抖尚未落盘，重启加载旧本地源，随后等待团队视角按钮超时。此次退出码 1、已完成 5 项，完整失败报告保留于 `native-real-cloud-annotations`；隔离数据和进程清理成功。测试改为确认原生偏好实际落盘后再关闭进程，未修改产品防抖逻辑，也未放宽画笔／数据库校验。

第二次执行已完成 6 项，画笔 CAS 及重启恢复通过；切换另一个普通成员时，原生读取 `canEdit=false`、原生保存 403 均已通过，但测试立即打开工具，稍后前端轮询发布新身份／连接键，安全切换将工具重新收起，导致等待只读提示超时。退出码 1，证据保留于 `native-real-cloud-annotations-retry`，清理成功。测试改为等待界面显示实际新成员身份后再展开工具，保留产品切换账号时关闭绘制的行为。

最终完整复验使用同一合成媒体和真实服务，在上述命令增加 `--with-annotations`，输出目录为 `native-real-cloud-annotations-final`。独立应用构建嵌入最新前端 `index-CcoSgOm5.js`（4943 模块），Tauri 构建耗时 20.05 秒、退出码 0。原生全部 **13 项通过、0 失败、页面异常 0，退出码 0**：

- 真实鼠标在视频内容范围内画箭头，归一化坐标与指针位置一致，撤销／重做恢复正确，界面保存后 PostgreSQL 实际版本为 1；另一视角没有该笔迹。
- 同版本两次并发保存仅一次成功、另一次 HTTP 409，真实 PostgreSQL 只有一份版本 2；关闭并重启原生应用后恢复同一版本和笔迹。
- 另一个普通成员读取 `canEdit=false`，原生界面工具禁用，原生保存被 403 拒绝；将该成员提升分析员后可保存。
- 上传者本人降为普通成员后仍可编辑自己的录像，保持真实权限语义；从团队移除后，标注读取和保存均被拒绝。
- 原有 Multipart 断点恢复、媒体 SHA、两路真实 HLS、WCL 导入／版本／权限、自定义轨道鼠标完整链均在该轮再次通过。

最终 `report.json` 的 `annotations` 九项事实均为真，`pageErrors=[]`；schema、bucket、自建进程清理全部成功，错误为空。`native-real-annotations.png` 已人工查看，笔迹正确覆盖实际视频且媒体控件正常显示。原始两份合成 MP4 摘要保持不变；真实用户日志、录像、正式应用数据均未写入。

### 本地非空标注保存与原生重启

补充 `client/tests/native-local-annotations.cjs`，只使用已固定的独立 `cloudvalidation` EXE、64 位十六进制合成 Pull ID、隔离 AppData 及合成 HLS，不启动数据库／MinIO／Redis，不修改生产代码或重新构建。执行该脚本（同前面的 `--fixture`、`--playwright` 参数，`--output` 为 `native-local-annotations`，`--exe` 为固定独立 EXE 拷贝）退出码 0，2 项通过、页面异常 0，耗时约 7.10 秒。

真实 `get_local_replay_annotations` 首次返回空版本 0；通过实际鼠标在视频上画箭头并点击保存后，真实 IPC 与 `client-state.json` 的 `replayAnnotations[PullId]` 均为版本 1，包含一条非空 Arrow、两个归一化坐标、颜色、线宽、战斗时刻 1000ms 和显示时间 5000ms，无关哨兵区段保留。关闭独立进程重启后，IPC 恢复完全相同的非空快照，真实视频上的 SVG 箭头重新显示。截图 `native-local-arrow-restarted.png` 已人工查看。

完整证据位于 `%TEMP%\wow-replay-phase2-20261017\native-local-annotations\report.json`，包含 `svgRenderedAfterRestart=true`、`formalArtifactsUnchanged=true`、`processStopped=true`。正式 debug EXE、release EXE 和 NSIS 安装包在该脚本前后 SHA-256 完全一致，两份合成源文件摘要也保持不变。

## 帧范围修复前的回归与构建（历史）

- `cargo test --lib`：112 总数，109 通过、0 失败、3 忽略，退出码 0；运行 16.45 秒、编译 18.42 秒。忽略项为两个显式真实数据测试及合成媒体生成器，不计为本轮通过。
- `node tests/native-cloud-replay.cjs ...`：使用最新画笔构建及空标注 GET 夹具，8 项通过、页面异常 0、退出码 0，约 8.33 秒。34 次本机 HTTP 请求，其中 23 次媒体请求，全部鉴权。此项是本机假 HTTP 夹具，真实服务 13 项证据另见上文。
- `node --test tests/runtime-assets.test.cjs`：3 通过、0 失败、退出码 0，460.86ms；探测运行时依赖闭包、图片摘要及真实样本技能来源／缺图清单一致。
- 默认配置 `npm run tauri -- build --debug --no-bundle`：退出码 0，前端 4943 模块／8.90 秒、Rust 28.98 秒。最终生成 `client/src-tauri/target/debug/wow-recorder-client.exe`，正式标识恢复为 `com.wow.recorder`，未启动该程序，未执行 NSIS。保留既有大 chunk 与 `diagnostics` 未使用提示。
- 对最终 `target/debug/game-data` 的 743 个清单文件逐一比较大小和 SHA-256，全部一致；1029 条技能引用去重后 740 张图，实际随包 741 张 JPEG（另 1 张保留旧种子图），不把引用数冒充图片文件数。最终 exe 大小 30,150,656 字节，SHA-256 为 `b8c93ab14a12f64c2f700f4e2402be9bedde75d37ffe9c9f4bb6681874e3676b`，独立验收标识字符串不再出现在正式构建中。只读校验结果保留于 `%TEMP%\wow-replay-phase2-20261017\final-build-assets.json`。

## 后续必须完成

真实部署需要明确服务地址、有效个人令牌、团队权限及生产存储环境。当前已验证本机真实服务的预签名校验、跨进程断点恢复、完整摘要复核、转码发布及私有播放权限；仍需线上 HTTPS 部署、生产网络故障条件和真实公共 WCL 报告的单独验收。受控 HTTP WCL 夹具只证明协议与任务闭环，不代表真实线上 WCL 访问已经验证。

## 帧范围修复前的 Release 安装包（历史，摘要已失效）

按最终交付要求执行 `npm run tauri build -- --bundles nsis`，实际转发参数为 `tauri.ps1 build --bundles nsis`，与 `npm run tauri -- build --bundles nsis` 等价。构建退出码 0，前端 4943 模块、8.56 秒，Release Rust 编译 57.53 秒，随后 NSIS 压缩成功生成 1 个安装包。未重新安装依赖、未调整版本或签名设置、未执行安装包、未启动正式应用。

| 产物 | 大小 | SHA-256 |
|---|---:|---|
| `client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe` | 124,986,963 字节 | `dbbf0a561b154ee37bfca01abd0d94f06c81d72019781cc7a964c1602e0748d2` |
| `client/src-tauri/target/release/wow-recorder-client.exe` | 20,890,624 字节 | `69b12c6a4be02c877c16c20086a9746e45a9f27a60750e567e4d3eeaa2dbb9cb` |

直接解析 Release EXE 的 PE 头确认 `Machine=0x8664`、`Magic=0x20b`、`Subsystem=2`，即 x64 Windows GUI 程序；正式标识为 `com.wow.recorder`，独立验收标识未混入。Release 的 `game-data` 同样完成 743 个清单文件大小与摘要核对。产物证据保留于 `%TEMP%\wow-replay-phase2-20261017\release-build-artifacts.json`。该步骤验证构建产物，未执行安装／卸载或覆盖正式用户配置，安装行为仍应在独立 Windows 验收环境检查。

## 帧范围修复后的交付（事件v3前的历史）

主线修复视频预滚／尾滚画面被截断战斗游标误标到边界的问题；标注按实际媒体时间映射判断战斗范围，范围外隐藏画布并禁用绘制。该次只修改 TypeScript／React，Rust、后端、API 和偏好契约未变，按约定只重做相关原生验证及构建，不重复无关全量测试。

独立 `cloudvalidation` 构建复用最新 `index-DhEuChGA.js`，Rust 编译 21.23 秒、退出码 0。`native-local-annotations.cjs` 扩为 3 项，退出码 0、页面异常 0、约 7.06 秒：非空 Arrow 鼠标保存、本地状态落盘和原生重启恢复全部通过；同一页面实际 `video.currentTime=0.5`、`13.5` 时 SVG 隐藏、绘制工具禁用，回到 `3` 秒恢复箭头和编辑，真实 IPC 与 `client-state.json` 的版本 1 及坐标始终不变。证据位于 `%TEMP%\wow-replay-phase2-20261017\native-local-annotations-frame-guard\report.json`。

随后默认 debug no-bundle 构建退出码 0，前端 4944 模块、8.38 秒，Rust 15.19 秒，正式标识恢复为 `com.wow.recorder`；未启动正式应用。上方旧 debug／Release／安装包摘要仅保留为历史，不再代表最终交付文件。

当时再次执行npm run tauri -- build --bundles nsis，退出码0：前端4944模块／8.54秒、Release Rust52.50秒，NSIS成功生成1个安装包。下表为该时点摘要，已被后续事件v3及媒体协议修复的安装包替代，最新值见阶段总表：

| 当前产物 | 大小 | SHA-256 |
|---|---:|---|
| `client/src-tauri/target/debug/wow-recorder-client.exe` | 30,150,656 字节 | `e3547697da9b8b1d05b264e3fc4d0ca78d3d57c719a2e9feca84e2bc431388ba` |
| `client/src-tauri/target/release/wow-recorder-client.exe` | 20,891,136 字节 | `c119d17ccc4a1cc727db743ba8b8f490317705a12221d3437d893c02051f5c77` |
| `client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe` | 124,988,485 字节 | `3d59f2042bbea169e04fe4b58b5204464c75d2c29fc79c54920fe35b9555c556` |

实际读取新 Release EXE 的 PE 头仍为 x64／Windows GUI 子系统 2；debug 和 Release 的 743 个资料清单文件大小及 SHA 全部一致，正式标识为 `com.wow.recorder`，未混入验收标识。最新 `final-build-assets.json` 与 `release-build-artifacts.json` 已更新，含被替代的历史摘要。未安装、未启动正式应用、未重新运行无关服务或全套测试。
