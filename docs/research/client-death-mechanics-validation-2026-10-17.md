# 客户端减伤与治疗耗材资料及验收

日期：2026-10-17（Asia/Shanghai）。继续客户端死亡复盘，界面沿用全局Ant Design主题，Web本轮不扩展。

后续已补客户端团队死亡窗口，本报告保留减伤阶段的证据与当时产物摘要；当前安装包和增量验证以[团队死亡专项](client-cloud-death-validation-2026-10-17.md)及阶段总表为准。

## 分类依据与范围

新增shared/review/mechanics固定资料及纯分类能力，客户端死亡面板单独展示分类记录，并按原日志时间定位当前视频。资料不接受用户导入的分类标签，技能名称只沿用实际日志，不参与分类判断。

资料来自Wago公开的12.1.5.70391版本[SpellEffect](https://wago.tools/db2/SpellEffect?build=12.1.5.70391)、[ItemEffect](https://wago.tools/db2/ItemEffect?build=12.1.5.70391)、[ItemXItemEffect](https://wago.tools/db2/ItemXItemEffect?build=12.1.5.70391)与[Item](https://wago.tools/db2/Item?build=12.1.5.70391)。原输入的URL、大小和SHA256保存在sources.json；不把约70MB原始表或实战日志加入仓库。枚举语义参考作者维护的[TrinityCore效果参考](https://trinitycore.info/database/master/world/serverside_spell_effect)与[光环定义](https://github.com/TrinityCore/TrinityCore/blob/master/src/server/game/Spells/Auras/SpellAuraDefines.h)，未复制其实现代码。

- 仅收录本次1036个实战技能中能从默认难度效果确认的84项资料。承伤降低要求光环87且基础值小于零，吸收为69、免疫为39、正值伤害分摊为81；保留DB2行ID，不把承伤增加分类成减伤。
- 团队范围只认明确小队／团队光环效果35／65；其余按实际来源及死者身份区分个人、外部或未知。团队范围资料不等于所有团员实际受到覆盖。
- 治疗耗材要求物品→使用效果→直接治疗技能的关联，限定药水子类及已核对的治疗石5512／恶魔治疗石224464，当前命中6262、452930、1262857、1295247四个技能。
- 实际发现杂项物品39163关联职业技能1064治疗链，已排除这种关联，避免把普通治疗判成耗材。单有物品使用关联不足以证明玩家消耗了该物品。
- 窗口只展示实际成功施法、对死者的增益记录、本人耗材治疗记录；不把施法开始、移除、负面光环或对其他人物施法当死者保护。来源缺失／nil／零GUID不冒充外部玩家，同名不参与身份判断。

所有分类均为固定资料解释，不保证与日志具体热修构建完全一致，不计算实际减伤量、有效覆盖、冷却或责任。治疗和成功施法分别展示，不相加为使用次数；未命中资料明确显示未知，不能断言未使用。窗口前光环仍保留在原摘要中，不作为本窗口使用记录重复列出。当前WCL来源不应用这套本地样本分类。

## 重建与验证

在仓库根目录使用backend/.venv/Scripts/python.exe执行client/tests/review/build-mechanic-catalog.py，传入--source公开CSV所在目录、--inventory匿名技能清单、--output shared/review/mechanics。重建在独立临时目录再次执行，catalog.ts和sources.json的SHA256均与当前文件一致。

- client目录npm run build：TypeScript与Vite退出0，保留既有大chunk提示；前端index-D7JKtZhR.js／index-CbFP4sl8.css。
- node --test --test-reporter=spec tests/review/mechanics.test.cjs tests/replay-review.test.cjs tests/wait-until.test.cjs：13通过、0失败、退出0，覆盖分类证据、耗材关联冲突、身份隔离、未知来源、窗口边界和原记录不变。
- client/tests/browser-replay.cjs：当前构建28项通过、pageErrors为空；真实React与HLS合成媒体，IPC为明确夹具。此矩阵回归现有回放交互，新增分类另由真实原生验收覆盖。
- 独立Tauri／Rust／WebView2首轮8组通过：38850个真实事件，死前窗口656条；分类3条、技能451447／462568，与独立Python直接读取日志得到的254条可分类候选逐事件身份一致。分类按钮定位实际视频且保留同一媒体实例；缺失／不支持／换源及恢复仍通过。
- 后续原生9组通过：另选实际死亡事件66988849，该玩家死前12748ms使用强效治疗药水1262857、死前12280ms使用治疗石6262，分别出现成功施法及治疗各一条；与独立CSV逐事件身份一致。对应物品为258138与5512，未将四条来源记录当四次使用。该死者没有本人实拍，索引没有把当前录像误认成其本人视角；分类点击仍定位当前可用视频。两者同屏[原生截图](images/client-death-mechanics-native-20261017.png)已目视核对，全局主题、文字及滚动正常。

证据位于临时wow-replay-phase2-20261017/client-mechanics-native-potion-stone（最新9组）、client-mechanics-native-consumables（先验治疗石）、client-mechanics-native（首轮8组）、client-mechanics-browser及client-mechanics-rebuild。原生测试的pageErrors为空、forcedStops为0；原片／HLS／源索引及测试时保护的正式产物摘要不变，隔离索引及client-state按字节恢复，进程停止。相关视角仍为同源控制样本，不代表其他成员实拍。另以node --test --test-reporter=spec执行test:replay原有六个测试文件，40通过、0失败、退出0。

## 限制

资料分类不等于完整减伤覆盖，本轮没有补齐全部技能及热修版本。明确致死关联、云端死亡窗口、阶段分析、自动漂移、真实多成员实拍精度、长时间硬件录制及发行矩阵仍待完成。未运行正式用户应用或安装包，没有自动提交／推送。

## 当前产物

正式debug与Release NSIS均构建退出0。当前安装包client/src-tauri/target/release/bundle/nsis/WoW Recorder_0.1.0_x64-setup.exe为125078204字节，SHA256 1057a49891dcb071aa6e32935f909b74f987b2fd2b3366ddc4d4d81adf1d9624，已包含本轮分类面板。

打包完成后的Release EXE为21281792字节、SHA256 64ff0734046f50f2b9bd7f8b0f96ddabfdd2268cf74c8958009926aff5ed7717；debug为30510080字节、SHA256 9d41939c18944c8efd03a72f82e33a5c6cb50fc3a7781569560e87281f292714。两套x64且无验收标识／临时诊断，Release子系统2；各743项技能资料及8项探测文件逐大小／SHA核验通过，许可原文一致。最终摘要保存在临时client-mechanics-build-artifacts.json，使用NSIS完成后的值。
