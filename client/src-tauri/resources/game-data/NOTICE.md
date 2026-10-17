# 随包技能图标资料

本包共 1029 项技能、741 张真实 JPEG。其中 1025 项覆盖用户授权的 17 场战斗中出现的 1036 个不同技能，不是全职业、全副本或完整游戏数据库。技能名称与事件时间仍以 CombatLog 为准，未知技能显示明确的缺图提示。

## 真实战斗资料来源

- 技能 ID 和中文名称来自真实 CombatLog 的技能展示字段；不包含人物名、角色 GUID、账号或令牌。
- 图标 FileDataID 来自 [Wago SpellMisc 12.1.5.70391 导出](https://wago.tools/db2/SpellMisc/csv?build=12.1.5.70391)。原始 CSV 为 45897457 字节，SHA-256：`99ca8265498bab7570fcd0614c35996d767ad6e1fd1cd338a563c07dd80bba86`。
- 图标文件名来自 [wowdev verified-listfile 202610152328](https://github.com/wowdev/wow-listfile/releases/tag/202610152328)，只接受已验证条目。原始 CSV 为 73566111 字节，SHA-256：`4d8c548dc485002ebefb3e973653cf842e8d83799e4cb3b5646318ba0f2064e6`，已匹配 GitHub 发布资产摘要。
- 随包图片下载自固定来源 `https://assets.rpglogs.com/img/warcraft/abilities/`。缺失项另对 Wowhead 固定图片 CDN 做有界离线下载检查，没有将未通过的资源收入包中。运行时仍使用原固定来源，没有扩大网络 endpoint。
- 日志只声明 `BUILD_VERSION=12.1.5`，没有完整构建号；可以确认版本系列一致，不能确认一定为 `70391`。

`source-map.json` 保存每项技能的 FileDataID、原始已验证文件名、下载 URL 与图片摘要；`manifest.json` 保存原始来源、逐资源 SHA-256、长度和覆盖清单。带空格的真实文件名使用 URL 编码下载，并映射到安全本地别名，不修改运行时路径限制。

## 覆盖与缺失

覆盖 1025/1036 个样本技能；原始所选类型事件覆盖 1346938/1361885 条。该事件分母是战斗区间内按原始类型筛选的 SPELL 记录，尚未应用生产索引的友敌等过滤，不等于最终时间轴事件总数。

仍有 11 项缺图：10 项对应图片下载未通过，1 项没有已验证文件名。候选原名及安全别名记录在 `failedMappings`，全部缺失技能和原因记录在 `coverage.missing`。没有用相似技能图片替代它们。可继续导入授权 WCL `masterData.abilities` 或更新公开资料补齐。

## 保留的初始资料

原 13 项常见技能资料与本次集合合并，各项来源保存在 `spells.json` 的 `source` 字段：

- [Blizzard API build 23420 公开历史导出](https://gist.github.com/Krudor/4ca34b5bf5de01bdd73aeca917f2fc34)：只取 ID、名称和图标引用，不引入旧版描述、数值或战斗规则。
- [眼镜蛇射击原始插件作者记录](https://www.mmo-champion.com/threads/2409805-WA2-BfA-BM-Thinking-Bar?p=49760341&viewfull=1)：核对该技能 ID 与图标引用。

名称及图片的权利归相应权利人。本项目没有复制第三方应用的业务实现。资料更新不会改变录像或事件事实。
