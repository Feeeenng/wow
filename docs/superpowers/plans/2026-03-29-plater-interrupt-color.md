# Plater 打断染色模组 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `d:/code/wow/plater/interrupt_color.lua`，一个 Plater 模组脚本，根据 NPC ID 查表对血条进行1/2/3人打断优先级染色。

**Architecture:** 单文件 Plater Mod，脚本顶部维护 INTERRUPT_LIST 数据表，Plater Config 系统提供颜色配置界面，挂载 OnShow 和 OnHealthUpdate 两个 Hook 执行染色逻辑。

**Tech Stack:** Lua 5.1（WoW 环境），Plater Mod API，WoW FrameXML API（UnitGUID, strsplit）

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `d:/code/wow/plater/interrupt_color.lua` | 新建 | 模组主文件，包含数据表、配置、Hook 逻辑 |

---

## Plater Mod 必要知识

Plater Mod 脚本结构固定，Plater 会 `require` 这个文件并调用其中的 Hook 函数：

```lua
local mod = {}
mod.name = "模组名"         -- Plater 界面显示名
mod.author = "作者"
mod.desc = "描述"

mod.Config = { ... }        -- 配置项定义，Plater 自动生成 UI

function mod:OnLoad(modConfig) end        -- 插件加载时调用一次
function mod:OnShow(unitframe, modConfig) end     -- 名条显示时调用
function mod:OnHide(unitframe, modConfig) end     -- 名条隐藏时调用
function mod:OnHealthUpdate(unitframe, modConfig) end  -- 血量变化时调用

return mod
```

关键 API：
- 从 unit token 解析 NPC ID：`local guid = UnitGUID(unitframe.unit)` → `tonumber(select(6, strsplit("-", guid)))`
- 设置血条颜色：`unitframe.healthBar:SetStatusBarColor(r, g, b)`
- 重置为默认颜色：`unitframe.healthBar:SetStatusBarColor(unitframe.healthBar.r, unitframe.healthBar.g, unitframe.healthBar.b)`
- 读取模组配置：`modConfig["color1"]` 返回 `{r, g, b, a}` 表

---

## Task 1: 创建模组骨架

**Files:**
- Create: `d:/code/wow/plater/interrupt_color.lua`

- [ ] **Step 1: 创建文件，写入模组骨架**

```lua
-- ============================================================
-- Interrupt Color — Plater 打断优先级染色模组
-- 根据怪物 NPC ID 对血条染色，显示需要几人打断
-- ============================================================

-- ============================================================
-- 打断分组数据表
-- 格式：[NPC_ID] = 需要几人打断 (1 / 2 / 3)
-- 添加新怪物只需在这里加一行，例：
--   [12345] = 1,  -- 怪物名（副本名）
--   [67890] = 2,
--   [11111] = 3,
-- ============================================================
local INTERRUPT_LIST = {

}

-- ============================================================
-- 模组定义
-- ============================================================
local mod = {}
mod.name = "打断优先级染色"
mod.author = ""
mod.desc = "根据怪物打断优先级对血条染色：绿=1人，橙=2人，蓝=3人"

mod.Config = {
    {
        key = "enabled",
        type = "toggle",
        default = true,
        name = "启用打断染色",
        desc = "启用后根据怪物打断优先级对血条染色",
    },
    {
        type = "label",
        get = function() return "颜色设置" end,
        text_template = "<size=14><color=FFFF00>%s</color></size>",
    },
    {
        key = "color1",
        type = "color",
        default = {0, 1, 0, 1},
        name = "1人打断颜色",
        desc = "只需1人打断的怪物血条颜色（默认：绿色）",
    },
    {
        key = "color2",
        type = "color",
        default = {1, 0.5, 0, 1},
        name = "2人打断颜色",
        desc = "需要2人打断的怪物血条颜色（默认：橙色）",
    },
    {
        key = "color3",
        type = "color",
        default = {0.2, 0.6, 1, 1},
        name = "3人打断颜色",
        desc = "需要3人打断的怪物血条颜色（默认：蓝色）",
    },
}

return mod
```

- [ ] **Step 2: 验证文件已创建**

在文件管理器或编辑器中确认 `d:/code/wow/plater/interrupt_color.lua` 存在，内容完整。

- [ ] **Step 3: Commit**

```bash
git -C d:/code/wow add plater/interrupt_color.lua
git -C d:/code/wow commit -m "feat: add interrupt color mod skeleton"
```

---

## Task 2: 实现核心 Hook 函数

**Files:**
- Modify: `d:/code/wow/plater/interrupt_color.lua`

- [ ] **Step 1: 在 `return mod` 之前添加辅助函数和 Hook**

在文件末尾 `return mod` 之前插入以下代码：

```lua
-- 从 unitframe 解析 NPC ID
local function GetNPCID(unitframe)
    if not unitframe or not unitframe.unit then return nil end
    local guid = UnitGUID(unitframe.unit)
    if not guid then return nil end
    -- GUID 格式: "Creature-0-XXXX-XXXX-XXXX-NPCID-XXXX"
    local npcID = tonumber(select(6, strsplit("-", guid)))
    return npcID
end

-- 对指定 unitframe 应用染色
local function ApplyColor(unitframe, modConfig)
    if not modConfig["enabled"] then return end

    local npcID = GetNPCID(unitframe)
    if not npcID then return end

    local count = INTERRUPT_LIST[npcID]
    if not count then return end  -- 不在列表里，不处理

    local c = modConfig["color" .. count]
    if not c then return end

    unitframe.healthBar:SetStatusBarColor(c[1], c[2], c[3])
end

function mod:OnShow(unitframe, modConfig)
    ApplyColor(unitframe, modConfig)
end

function mod:OnHealthUpdate(unitframe, modConfig)
    ApplyColor(unitframe, modConfig)
end

function mod:OnHide(unitframe, modConfig)
    -- 隐藏时无需处理，Plater 会自动重置
end
```

- [ ] **Step 2: 确认文件末尾结构正确**

文件末尾应为：

```lua
function mod:OnHide(unitframe, modConfig)
    -- 隐藏时无需处理，Plater 会自动重置
end

return mod
```

- [ ] **Step 3: Commit**

```bash
git -C d:/code/wow add plater/interrupt_color.lua
git -C d:/code/wow commit -m "feat: implement OnShow and OnHealthUpdate hooks for interrupt coloring"
```

---

## Task 3: 游戏内安装与测试

**Files:**
- 无需修改代码，仅操作游戏内 Plater 界面

- [ ] **Step 1: 将模组导入 Plater**

1. 打开游戏，进入 Plater 设置界面（`/plater` 或通过插件列表）
2. 找到 **Mods（模组）** 标签页
3. 点击 **Import Mod（导入模组）**
4. 将 `interrupt_color.lua` 的完整内容粘贴进去
5. 点击确认导入

- [ ] **Step 2: 验证配置界面显示正常**

在 Plater → Mods → 打断优先级染色，应看到：
- ✅ "启用打断染色" 开关（默认开启）
- ✅ "颜色设置" 标签
- ✅ "1人打断颜色" 颜色选择器（绿色）
- ✅ "2人打断颜色" 颜色选择器（橙色）
- ✅ "3人打断颜色" 颜色选择器（蓝色）

- [ ] **Step 3: 添加测试 NPC ID 并验证染色**

在 `INTERRUPT_LIST` 中临时添加一个已知副本中的怪物 NPC ID，例如：

```lua
local INTERRUPT_LIST = {
    [XXXXX] = 1,  -- 替换为实际能遇到的怪物 NPC ID
}
```

进入副本，靠近该怪物，确认血条变为绿色。

**获取 NPC ID 的方法：** 使用 `/run print(select(6, strsplit("-", UnitGUID("target"))))` 命令，目标该怪物后执行，聊天框输出即为 NPC ID。

- [ ] **Step 4: 验证不在列表的怪物不受影响**

靠近列表外的其他怪物，血条颜色应保持 Plater 原有颜色，不变色。

- [ ] **Step 5: 验证禁用开关有效**

在配置界面关闭"启用打断染色"，列表内的怪物血条应恢复原色。

---

## Task 4: 填入实际数据（持续维护）

**Files:**
- Modify: `d:/code/wow/plater/interrupt_color.lua`（数据表部分）

- [ ] **Step 1: 实战中获取 NPC ID**

每次遇到需要标记打断优先级的怪物，目标该怪物后执行：

```
/run print(select(6, strsplit("-", UnitGUID("target"))))
```

聊天框输出的数字即为 NPC ID。

- [ ] **Step 2: 在 INTERRUPT_LIST 中添加记录**

```lua
local INTERRUPT_LIST = {
    -- ===== 副本名 =====
    [NPCID] = 1,  -- 怪物名
    [NPCID] = 2,  -- 怪物名
    [NPCID] = 3,  -- 怪物名
}
```

- [ ] **Step 3: 重新导入 Plater（每次修改数据后）**

重复 Task 3 Step 1 的导入步骤，用新内容覆盖旧模组。或在 Plater 的脚本编辑器中直接编辑已导入的模组脚本。

- [ ] **Step 4: Commit 数据更新**

```bash
git -C d:/code/wow add plater/interrupt_color.lua
git -C d:/code/wow commit -m "data: add NPC IDs for [副本名]"
```
