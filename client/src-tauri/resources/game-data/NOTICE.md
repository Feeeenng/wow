# 随包技能图标资料

本包共 1166 项技能、825 张真实图片（810 张 JPEG、15 张 PNG）。保留原1036项样本覆盖，并补齐指定日志中176种已观测敌方施法，包括优先处理的12.1史诗盘卷祭坛22次战斗、50种施法。不是全职业、全副本或完整游戏数据库。技能名称与事件时间仍以 CombatLog 为准，未知技能显示真实ID，不以问号图片冒充已知技能。

## 真实战斗资料来源

- 技能 ID 和中文名称来自真实 CombatLog 的技能展示字段；不包含人物名、角色 GUID、账号或令牌。
- 图标 FileDataID 来自 [Wago SpellMisc 12.1.5.70391 导出](https://wago.tools/db2/SpellMisc/csv?build=12.1.5.70391)。原始 CSV 为 45897457 字节，SHA-256：`99ca8265498bab7570fcd0614c35996d767ad6e1fd1cd338a563c07dd80bba86`。
- 图标文件名来自 [wowdev verified-listfile 202610152328](https://github.com/wowdev/wow-listfile/releases/tag/202610152328)，只接受已验证条目。原始 CSV 为 73566111 字节，SHA-256：`4d8c548dc485002ebefb3e973653cf842e8d83799e4cb3b5646318ba0f2064e6`，已匹配 GitHub 发布资产摘要。
- 随包图片下载自固定来源 `https://assets.rpglogs.com/img/warcraft/abilities/`。缺失项另对 Wowhead 固定图片 CDN 做有界离线下载检查，没有将未通过的资源收入包中。运行时仍使用原固定来源，没有扩大网络 endpoint。
- 另有 10 张 PNG 从本机游戏 `12.1.5.70448` 的固定 CASC 构建读取，补齐 11 项技能。使用作者发布的 [WoW.tools.local 0.9.9](https://github.com/Marlamin/wow.tools.local/releases/tag/0.9.9)，发布包 28040158 字节、SHA-256 `c478346e9fbae3be275d2089f1c38175e81950785b0b05cb8858c1ddd4692df7`。工具按 FileDataID 读取原始 BLP，使用其 BLPSharp／NetVips 解码为 PNG；原始内容 MD5 与固定 CASC 清单逐项相符，没有按名字猜图或以相似图片替代。
- `local-icons.json` 保存上述图片的 BLP／PNG 摘要、内容 MD5、尺寸、工具身份及固定构建配置。图像构建 `70448` 与技能映射资料构建 `70391` 分别记录，不能据此声称图像与日志完整构建完全相同。该工具只在隔离临时目录运行，不是应用运行时依赖，也不随客户端分发。
- 日志只声明 `BUILD_VERSION=12.1.5`，没有完整构建号；可以确认版本系列一致，不能确认一定为 `70391`。

`source-map.json` 保存每项技能的 FileDataID、原始已验证文件名、下载 URL 与图片摘要；本地 CASC 图片明确标记来源，下载 URL 为 null，没有已验证文件名的 8268563 保留 null。`manifest.json` 保存原始来源、逐资源 SHA-256、长度和覆盖清单。带空格的真实文件名使用 URL 编码下载，本地 PNG 统一使用 FileDataID 安全别名，不修改运行时路径限制。

## 覆盖与缺失

2026-10-18新增Boss资料：只读扫描授权的10月16日两份及17日一份日志，按生产解析器的敌对NPC／载具标志筛选战斗区间内施法；`boss-abilities.json`保留日志文件大小／SHA、版本声明、首领／难度／场次数和技能来源。176种施法均有图，新增126项技能、69张JPEG及5张PNG，不覆盖原玩家技能映射。

Boss图标仍由固定SpellMisc构建及已验证文件名确定，优先难度16条目、再用通用条目。5张下载失败或文件名不适合运行时路径的图片按FileDataID从固定CASC构建读取，BLP内容MD5与清单一致，PNG摘要和尺寸保存在Boss资料的localCasc区段。没有扩大运行时网络源、修改游戏目录或将未验证图片作为占位。史诗覆盖仅为已观测盘卷祭坛，不冒充其他史诗首领的未观测机制已经完整覆盖。

覆盖 1036/1036 个样本技能；原始所选类型事件覆盖 1361885/1361885 条。该事件分母是战斗区间内按原始类型筛选的 SPELL 记录，尚未应用生产索引的友敌等过滤，不等于最终时间轴事件总数。

这批样本的 `failedMappings` 与 `coverage.missing` 均为空。两个棱彩飞弹技能共享同一 FileDataID，所以 11 项技能只需补 10 张图片。未来日志出现的新技能仍需独立核验，可导入授权 WCL `masterData.abilities` 或更新公开资料；当前完整样本覆盖不能解释为游戏全量覆盖。

## 保留的初始资料

原 13 项常见技能资料与本次集合合并，各项来源保存在 `spells.json` 的 `source` 字段：

- [Blizzard API build 23420 公开历史导出](https://gist.github.com/Krudor/4ca34b5bf5de01bdd73aeca917f2fc34)：只取 ID、名称和图标引用，不引入旧版描述、数值或战斗规则。
- [眼镜蛇射击原始插件作者记录](https://www.mmo-champion.com/threads/2409805-WA2-BfA-BM-Thinking-Bar?p=49760341&viewfull=1)：核对该技能 ID 与图标引用。

名称及图片的权利归相应权利人。本项目没有复制第三方应用的业务实现。资料更新不会改变录像或事件事实。

## 固定版本技能说明

`spell-tooltips.json` 使用 Wago 公开 DB2 的 `12.1.5.70391` 构建，包含中文说明与英文名称，共1157项；1166个随包技能中9项源表没有说明，保持缺失。已观测176项Boss技能覆盖169项；盘卷祭坛史诗50项覆盖48项，不冒充全量史诗机制。公开表的下载地址、原始文件大小及SHA256、生成器摘要、原始说明样本和缺失清单见 `spell-tooltips-source.json`。

说明为游戏资料的纯文本展示，不运行Wowhead脚本，不复制ReviewTool业务代码。按同构建表确定静态持续时间、范围、基础施法和冷却；动态伤害／治疗和无法确定的表达式显示明确占位与说明，不按录像中的角色、装备、难度或天赋猜数值。公开资料中的基础冷却也不代表录像人物的实际冷却。离线生成器为 `client/tests/game-data/build-spell-tooltips.py`，只读取显式指定的CSV输入目录，不联网。
