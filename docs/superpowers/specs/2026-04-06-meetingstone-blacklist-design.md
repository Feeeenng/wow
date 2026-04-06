# MeetingStone 黑名单插件 设计文档

**日期：** 2026-04-06  
**状态：** 待实现  

---

## 概述

开发一个独立的 WoW Addon `MeetingStone_Blacklist`，作为集合石（MeetingStone）的补充插件。

黑名单功能与现有的"屏蔽玩家"（IGNORE_LIST，隐藏队伍）功能**独立并存**，行为不同：
- **屏蔽**：将队伍从查找活动列表中隐藏
- **黑名单**：队伍仍然显示，但用视觉标记（红色背景）提醒用户该队伍含有黑名单成员

---

## 功能范围

### 功能一：右键菜单拉黑
在"查找活动"列表（BrowsePanel）的每条活动右键菜单中，新增"加入黑名单"选项。
- 点击后弹出 `GUI:CallInputDialog` 输入框，提示用户输入理由（可留空）
- 确认后：将队长名写入黑名单数据，立即刷新列表视觉标记

### 功能二：视觉标记
查找活动列表中，如果某队伍的**任意成员**（通过 `C_LFGList.GetSearchResultMemberCounts` 和 `LfgService:GetSearchResultMemberInfo` 遍历）在黑名单中，该行背景渲染为**半透明红色**。

### 功能三：黑名单管理面板
新增主界面标签页"黑名单"（注册在"屏蔽玩家列表"标签之后）。
- 列表列：玩家名、拉黑时间、理由
- 底部按钮：勾选后"移除选中"、全选/取消全选

---

## 架构

### 独立 Addon 结构

```
MeetingStone_Blacklist/
├── MeetingStone_Blacklist.toc   -- TOC，依赖 MeetingStone
├── Core.lua                      -- 数据管理、初始化、全局 API
├── BlacklistPanel.lua            -- 黑名单管理面板 UI
└── Hooks.lua                     -- 注入 BrowsePanel 右键菜单和视觉标记
```

### TOC 依赖声明

```
## Dependencies: MeetingStone
## SavedVariables: MEETINGSTONE_BLACKLIST_DB
```

MeetingStone 的 TOC 使用 `LoadManagers: AddonLoader` + `X-LoadOn-Always: delayed`，本插件同样使用延迟加载，并在 `PLAYER_LOGIN` 事件之后执行 hook 注入，确保 MeetingStone 模块初始化完毕。

### MeetingStone 源码最小修改

需要在 `MeetingStone/Module/BrowsePanel.lua` 中做两处最小修改：

**修改 1**：在 `ActivityList` 创建后（约第 35 行）存储到 `self`，供外部 addon 访问：
```lua
self.ActivityList = ActivityList
```

**修改 2**：在 `ActivityList:SetCallback('OnItemFormatted', ...)` 回调末尾，添加黑名单视觉标记检查：
```lua
-- 黑名单视觉标记（由 MeetingStone_Blacklist 插件提供数据）
if MeetingStone_Blacklist then
    MeetingStone_Blacklist:ApplyBlacklistMark(button, item)
end
```

---

## 数据结构

### SavedVariables

```lua
MEETINGSTONE_BLACKLIST_DB = {
    players = {
        -- key: "名字-服务器" 格式（如 "张三-风暴之怒"）
        -- value: { reason = "理由文本", time = "2026-04-06 12:00" }
        ["张三-风暴之怒"] = { reason = "出言不逊", time = "2026-04-06 12:00" },
    }
}
```

### 全局 API（供 BrowsePanel 回调使用）

`MeetingStone_Blacklist` 全局表暴露以下方法：

| 方法 | 说明 |
|------|------|
| `MeetingStone_Blacklist:Add(name, reason)` | 添加玩家到黑名单 |
| `MeetingStone_Blacklist:Remove(name)` | 移除玩家 |
| `MeetingStone_Blacklist:IsBlacklisted(name)` | 返回 true/false |
| `MeetingStone_Blacklist:GetAll()` | 返回数组：`{{name=..., reason=..., time=...}, ...}`（用于面板渲染） |
| `MeetingStone_Blacklist:ApplyBlacklistMark(button, item)` | 在行按钮上应用或清除红色背景 |

---

## 各文件详细设计

### Core.lua

- 监听 `ADDON_LOADED` 事件，当 `MeetingStone` 和本插件均加载后执行初始化
- 初始化 `MEETINGSTONE_BLACKLIST_DB.players`（若不存在则创建空表）
- 实现全局 API 方法
- 监听 `PLAYER_LOGIN`，在此时机执行 Hooks.lua 中的注入逻辑

### Hooks.lua

**右键菜单注入：**

在 `PLAYER_LOGIN` 后，替换 `BrowsePanel.ToggleActivityMenu`：

```lua
local origMenu = BrowsePanel.ToggleActivityMenu
BrowsePanel.ToggleActivityMenu = function(self, anchor, activity)
    -- 在原始菜单表中插入"加入黑名单"选项后再调用
    -- 通过重写 GUI:ToggleMenu 的调用参数实现
    -- 具体：构造新菜单表，在 CANCEL 之前插入黑名单选项
end
```

由于 `GUI:ToggleMenu` 接受菜单表作为参数，不能直接注入，需要完整重写 `ToggleActivityMenu` 方法，在原始逻辑基础上增加菜单项。

**视觉标记（`ApplyBlacklistMark`）：**

```lua
function MeetingStone_Blacklist:ApplyBlacklistMark(button, item)
    local leader = item:GetLeader()
    local isBlacklisted = false
    
    -- 检查队长
    if leader and self:IsBlacklisted(leader) then
        isBlacklisted = true
    end
    
    -- 检查全队成员（使用原始 WoW API，因为 LfgService:GetSearchResultMemberInfo 不返回玩家名）
    if not isBlacklisted then
        for i = 1, item:GetNumMembers() do
            local info = C_LFGList.GetSearchResultPlayerInfo(item:GetID(), i)
            if info and info.name and self:IsBlacklisted(info.name) then
                isBlacklisted = true
                break
            end
        end
    end
    
    -- 应用或清除标记
    if not button._blacklistOverlay then
        local overlay = button:CreateTexture(nil, 'OVERLAY')
        overlay:SetAllPoints()
        overlay:SetColorTexture(1, 0, 0, 0.15)
        button._blacklistOverlay = overlay
    end
    button._blacklistOverlay:SetShown(isBlacklisted)
end
```

### BlacklistPanel.lua

- 使用 `MainPanel:RegisterPanel('黑名单', self, {after = '屏蔽玩家列表'})` 注册新标签页
- 使用 `GUI:GetClass('DataGridView'):New(self)` 创建列表，列定义：
  - 勾选框（用于批量删除）
  - 玩家名（宽 200）
  - 拉黑时间（宽 200）
  - 理由（宽 350）
- 底部按钮：
  - "移除选中"：从 `MEETINGSTONE_BLACKLIST_DB.players` 中删除勾选项
  - "全选/取消全选"
- 数据来源：`MeetingStone_Blacklist:GetAll()` 返回的数组，面板 OnShow 时刷新

---

## 交互流程

```
用户右键点击活动列表中的队伍
  → 弹出菜单（包含"加入黑名单"选项）
  → 点击"加入黑名单"
  → 弹出输入框："请输入拉黑理由（可留空）"
  → 用户输入理由，点击确认
  → MeetingStone_Blacklist:Add(leaderName, reason)
  → BrowsePanel.ActivityList:Refresh()  （触发重新渲染）
  → 该队伍行出现红色背景标记

用户打开"黑名单"标签页
  → 显示所有黑名单玩家列表（名字、时间、理由）
  → 勾选条目后点击"移除选中"
  → 从列表移除，刷新面板
```

---

## 注意事项

1. **玩家名格式**：存储时统一为 `"名字-服务器"` 格式。若队长名不含 `-`，自动追加 `-` + `GetRealmName()`（与现有 BrowsePanel 逻辑一致）
2. **加载顺序**：hook 注入必须在 `PLAYER_LOGIN` 之后，此时 MeetingStone 的所有模块（包括 BrowsePanel）已完成 `OnInitialize`
3. **性能**：`ApplyBlacklistMark` 在每次行渲染时调用，黑名单查询使用 table key 查找（O(1)），不影响性能
4. **兼容性**：所有对 `MeetingStone_Blacklist` 的调用前都检查全局变量是否存在，确保 MeetingStone 在未加载本插件时正常工作
