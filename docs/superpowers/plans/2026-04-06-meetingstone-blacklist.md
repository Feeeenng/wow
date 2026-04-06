# MeetingStone Blacklist Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone WoW addon `MeetingStone_Blacklist` that lets players right-click any LFG group to blacklist its leader with a reason, marks blacklisted groups visually in the browse list, and provides a management panel to view/remove entries.

**Architecture:** Separate addon with its own SavedVariables (`MEETINGSTONE_BLACKLIST_DB` as array). Hooks into MeetingStone at `PLAYER_LOGIN` by replacing `BrowsePanel.ToggleActivityMenu` and calling back into `ApplyBlacklistMark`. Two minimal changes to MeetingStone's `BrowsePanel.lua` expose `self.ActivityList` and call the mark function.

**Tech Stack:** WoW Lua addon (Interface 120001), NetEaseGUI-2.0, AceAddon-3.0 (via LibStub), MeetingStone's `GUI:CallInputDialog` for input, `MainPanel:RegisterPanel` for the new tab.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `MeetingStone_Blacklist/MeetingStone_Blacklist.toc` | Create | Addon metadata, dependency declaration, file load order |
| `MeetingStone_Blacklist/Core.lua` | Create | Data init, lookup table, global API (`Add`, `Remove`, `IsBlacklisted`, `GetAll`, `ApplyBlacklistMark`) |
| `MeetingStone_Blacklist/Hooks.lua` | Create | Replace `BrowsePanel.ToggleActivityMenu` at PLAYER_LOGIN to inject blacklist menu item and trigger input dialog |
| `MeetingStone_Blacklist/BlacklistPanel.lua` | Create | Management UI panel: DataGridView list + remove buttons, registered as "黑名单" tab |
| `MeetingStone/Module/BrowsePanel.lua` | Modify | Two-line change: store `self.ActivityList`, call `MeetingStone_Blacklist:ApplyBlacklistMark` in `OnItemFormatted` |

---

## Task 1: Addon Scaffold — TOC + Core.lua skeleton

**Files:**
- Create: `MeetingStone_Blacklist/MeetingStone_Blacklist.toc`
- Create: `MeetingStone_Blacklist/Core.lua`

- [ ] **Step 1: Create the TOC file**

```
## Interface: 120001
## Version: 1.0.0
## Title: MeetingStone Blacklist
## Title-zhCN: 集合石黑名单
## Notes-zhCN: 为集合石插件添加黑名单功能
## Dependencies: MeetingStone
## SavedVariables: MEETINGSTONE_BLACKLIST_DB
## X-LoadOn-Always: delayed

Core.lua
Hooks.lua
BlacklistPanel.lua
```

Save to: `MeetingStone_Blacklist/MeetingStone_Blacklist.toc`

- [ ] **Step 2: Create Core.lua skeleton**

```lua
-- Core.lua
MeetingStone_Blacklist = {}
local BL = MeetingStone_Blacklist

-- Built at load time from saved array for O(1) lookup
BL.lookup = {}

local frame = CreateFrame('Frame')
frame:RegisterEvent('ADDON_LOADED')
frame:RegisterEvent('PLAYER_LOGIN')
frame:SetScript('OnEvent', function(self, event, arg1)
    if event == 'ADDON_LOADED' and arg1 == 'MeetingStone_Blacklist' then
        -- Initialize SavedVariables
        if not MEETINGSTONE_BLACKLIST_DB then
            MEETINGSTONE_BLACKLIST_DB = {}
        end
        -- Rebuild in-memory lookup from saved array
        for _, entry in ipairs(MEETINGSTONE_BLACKLIST_DB) do
            if entry.name then
                BL.lookup[entry.name] = true
            end
        end
    elseif event == 'PLAYER_LOGIN' then
        BL:OnLogin()
    end
end)

function BL:OnLogin()
    -- Hooks.lua and BlacklistPanel.lua call-targets are wired here
    -- (implemented in later tasks)
end
```

- [ ] **Step 3: Create empty placeholder files so the TOC doesn't error**

`MeetingStone_Blacklist/Hooks.lua`:
```lua
-- Hooks.lua (placeholder, implemented in Task 3)
```

`MeetingStone_Blacklist/BlacklistPanel.lua`:
```lua
-- BlacklistPanel.lua (placeholder, implemented in Task 7)
```

- [ ] **Step 4: Verify addon loads without errors**

In WoW, type:
```
/reload
```
Then open chat and check for any Lua errors. Also run:
```
/run print(MeetingStone_Blacklist ~= nil and "BL OK" or "BL MISSING")
```
Expected output: `BL OK`

- [ ] **Step 5: Commit**

```bash
git add MeetingStone_Blacklist/
git commit -m "feat: scaffold MeetingStone_Blacklist addon with empty stubs"
```

---

## Task 2: Data Storage & Lookup API

**Files:**
- Modify: `MeetingStone_Blacklist/Core.lua`

- [ ] **Step 1: Add the five API methods to Core.lua**

Replace `-- (implemented in later tasks)` in `Core.lua` with these methods (add after the `BL.lookup = {}` line, before the frame setup):

```lua
-- Normalize player name to "Name-Realm" format
local function normalizeName(name)
    if name and not name:find('-') then
        name = name .. '-' .. GetRealmName()
    end
    return name
end

function BL:Add(name, reason)
    name = normalizeName(name)
    if not name or self.lookup[name] then return end
    self.lookup[name] = true
    table.insert(MEETINGSTONE_BLACKLIST_DB, 1, {
        name   = name,
        reason = reason or '',
        time   = date('%Y-%m-%d %H:%M', time()),
    })
end

function BL:Remove(name)
    name = normalizeName(name)
    if not name then return end
    self.lookup[name] = nil
    for i = #MEETINGSTONE_BLACKLIST_DB, 1, -1 do
        if MEETINGSTONE_BLACKLIST_DB[i].name == name then
            table.remove(MEETINGSTONE_BLACKLIST_DB, i)
            break
        end
    end
end

function BL:IsBlacklisted(name)
    if not name then return false end
    -- Check both raw name and normalized form
    return self.lookup[name] or self.lookup[normalizeName(name)] or false
end

function BL:GetAll()
    return MEETINGSTONE_BLACKLIST_DB
end
```

- [ ] **Step 2: Verify API in-game**

```
/reload
/run MeetingStone_Blacklist:Add("TestPlayer-TestRealm", "测试理由")
/run print(MeetingStone_Blacklist:IsBlacklisted("TestPlayer-TestRealm"))
```
Expected: `true`

```
/run MeetingStone_Blacklist:Remove("TestPlayer-TestRealm")
/run print(MeetingStone_Blacklist:IsBlacklisted("TestPlayer-TestRealm"))
```
Expected: `false`

```
/run MeetingStone_Blacklist:Add("TestPlayer2-TestRealm", "理由2")
/run for _, e in ipairs(MeetingStone_Blacklist:GetAll()) do print(e.name, e.reason, e.time) end
```
Expected: one line showing `TestPlayer2-TestRealm  理由2  <date>`

- [ ] **Step 3: Commit**

```bash
git add MeetingStone_Blacklist/Core.lua
git commit -m "feat: add BL data API (Add/Remove/IsBlacklisted/GetAll)"
```

---

## Task 3: BrowsePanel Minimal Changes

**Files:**
- Modify: `MeetingStone/Module/BrowsePanel.lua`

- [ ] **Step 1: Expose ActivityList on BrowsePanel**

In `BrowsePanel.lua`, find this line (around line 35):
```lua
  local ActivityList = GUI:GetClass('DataGridView'):New(self)
  do
```

Add `self.ActivityList = ActivityList` immediately after the `do` line (after line 36):
```lua
  local ActivityList = GUI:GetClass('DataGridView'):New(self)
  do
    self.ActivityList = ActivityList   -- <-- ADD THIS LINE
    ActivityList:SetAllPoints(self)
```

- [ ] **Step 2: Add blacklist mark call in OnItemFormatted**

Find the existing `ActivityList:SetCallback('OnItemFormatted', ...)` block (around line 534). It ends with:
```lua
      else
        button.SameInstanceBgLeft:Hide()
      end
    end)
  end
```

Add the blacklist call just before the final `end)`:
```lua
      else
        button.SameInstanceBgLeft:Hide()
      end
      -- 黑名单视觉标记（MeetingStone_Blacklist 插件提供）
      if MeetingStone_Blacklist then
        MeetingStone_Blacklist:ApplyBlacklistMark(button, item)
      end
    end)
  end
```

- [ ] **Step 3: Verify no errors when blacklist addon is NOT loaded**

Temporarily disable `MeetingStone_Blacklist` addon in the addon list, reload, open the browse panel, scroll through groups. No Lua errors should appear.

Re-enable `MeetingStone_Blacklist` after verification.

- [ ] **Step 4: Commit**

```bash
git add MeetingStone/Module/BrowsePanel.lua
git commit -m "feat: expose ActivityList on BrowsePanel, add optional blacklist mark hook"
```

---

## Task 4: Right-Click Menu Hook

**Files:**
- Modify: `MeetingStone_Blacklist/Hooks.lua`

- [ ] **Step 1: Implement Hooks.lua with ToggleActivityMenu replacement**

Replace the placeholder content of `Hooks.lua` with:

```lua
-- Hooks.lua
local BL = MeetingStone_Blacklist

function BL:SetupHooks()
    local origToggleActivityMenu = BrowsePanel.ToggleActivityMenu

    BrowsePanel.ToggleActivityMenu = function(self, anchor, activity)
        local usable, reason = self:CheckSignUpStatus(activity)
        local leader = activity:GetLeader()

        GUI:ToggleMenu(anchor, {
            {
                text = activity:GetName(),
                isTitle = true,
                notCheckable = true,
            },
            {
                text = WHISPER_LEADER,
                func = function()
                    ChatFrame_SendTell(leader)
                end,
                disabled = not leader,
                tooltipTitle = not activity:IsApplication() and WHISPER,
                tooltipText = not activity:IsApplication() and LFG_LIST_MUST_SIGN_UP_TO_WHISPER,
                tooltipOnButton = true,
                tooltipWhileDisabled = true,
            },
            {
                text = LFG_LIST_REPORT_GROUP_FOR,
                func = function()
                    LFGList_ReportListing(activity:GetID(), leader)
                    LFGListSearchPanel_UpdateResultList(LFGListFrame.SearchPanel)
                end,
            },
            {
                text = REPORT_GROUP_FINDER_ADVERTISEMENT,
                notCheckable = true,
                func = function()
                    LFGList_ReportAdvertisement(activity:GetID(), leader)
                    LFGListSearchPanel_UpdateResultList(LFGListFrame.SearchPanel)
                end,
            },
            {
                text = '加入黑名单',
                notCheckable = true,
                func = function()
                    BL:PromptAddToBlacklist(leader, activity)
                end,
            },
            {
                text = CANCEL,
            },
        }, 'cursor')
    end
end
```

- [ ] **Step 2: Wire SetupHooks into BL:OnLogin in Core.lua**

In `Core.lua`, replace the `BL:OnLogin` body:
```lua
function BL:OnLogin()
    BL:SetupHooks()
end
```

- [ ] **Step 3: Verify "加入黑名单" appears in right-click menu**

```
/reload
```
Open MeetingStone → 查找活动 → right-click any group in the list.

Expected: Menu shows: 活动类型标题 / 私聊队长 / 举报 / 举报广告 / **加入黑名单** / 取消

- [ ] **Step 4: Commit**

```bash
git add MeetingStone_Blacklist/Hooks.lua MeetingStone_Blacklist/Core.lua
git commit -m "feat: hook BrowsePanel right-click menu to add 加入黑名单 option"
```

---

## Task 5: Reason Input Dialog

**Files:**
- Modify: `MeetingStone_Blacklist/Hooks.lua`

- [ ] **Step 1: Add PromptAddToBlacklist method to Hooks.lua**

Add at the bottom of `Hooks.lua`:

```lua
function BL:PromptAddToBlacklist(leader, activity)
    if not leader then return end

    -- Normalize leader name
    if not leader:find('-') then
        leader = leader .. '-' .. GetRealmName()
    end

    GUI:CallInputDialog(
        '将 |cffffd700' .. leader .. '|r 加入黑名单\n请输入理由（可留空）：',
        function(confirmed, inputText)
            if not confirmed then return end
            BL:Add(leader, inputText or '')
            -- Refresh the browse list so mark appears immediately
            if BrowsePanel.ActivityList then
                BrowsePanel.ActivityList:Refresh()
            end
            print('|cffff4444[黑名单]|r 已将 ' .. leader .. ' 加入黑名单')
            -- Refresh blacklist panel if it's open
            if BlacklistPanel and BlacklistPanel.BlacklistList then
                BlacklistPanel.BlacklistList:Refresh()
            end
        end,
        leader,  -- unique key so multiple dialogs don't stack
        '',      -- default text (empty)
        200,     -- maxBytes
        260      -- editBoxWidth
    )
end
```

- [ ] **Step 2: Verify dialog appears and writes data**

```
/reload
```
Open 查找活动 → right-click a group → 加入黑名单.

Expected:
1. Input dialog appears: "将 Name-Realm 加入黑名单 / 请输入理由（可留空）："
2. Type a reason, press OK.
3. Chat shows: `[黑名单] 已将 Name-Realm 加入黑名单`

Verify data was saved:
```
/run for _, e in ipairs(MEETINGSTONE_BLACKLIST_DB) do print(e.name, e.reason) end
```
Expected: one entry showing the leader name and reason.

- [ ] **Step 3: Commit**

```bash
git add MeetingStone_Blacklist/Hooks.lua
git commit -m "feat: add reason input dialog for blacklist, print confirmation"
```

---

## Task 6: Visual Row Marking (ApplyBlacklistMark)

**Files:**
- Modify: `MeetingStone_Blacklist/Core.lua`

- [ ] **Step 1: Add ApplyBlacklistMark to Core.lua**

Add at the bottom of `Core.lua`:

```lua
function BL:ApplyBlacklistMark(button, item)
    local isBlacklisted = false

    -- Check leader
    local leader = item:GetLeader()
    if leader and self:IsBlacklisted(leader) then
        isBlacklisted = true
    end

    -- Check all members (only if leader wasn't flagged)
    if not isBlacklisted then
        for i = 1, item:GetNumMembers() do
            local info = C_LFGList.GetSearchResultPlayerInfo(item:GetID(), i)
            if info and info.name and self:IsBlacklisted(info.name) then
                isBlacklisted = true
                break
            end
        end
    end

    -- Create or reuse overlay texture
    if not button._blOverlay then
        local overlay = button:CreateTexture(nil, 'OVERLAY')
        overlay:SetAllPoints()
        overlay:SetColorTexture(1, 0, 0, 0.18)
        button._blOverlay = overlay
    end

    button._blOverlay:SetShown(isBlacklisted)
end
```

- [ ] **Step 2: Verify red background appears for blacklisted leaders**

First, blacklist the leader of a visible group (use Task 5's right-click flow, or run):
```
/run MeetingStone_Blacklist:Add("SomeLeader-SomeRealm", "测试")
/run if BrowsePanel.ActivityList then BrowsePanel.ActivityList:Refresh() end
```

Open 查找活动. Any group whose leader matches `SomeLeader-SomeRealm` should have a faint red background overlay.

To clean up:
```
/run MeetingStone_Blacklist:Remove("SomeLeader-SomeRealm")
/run if BrowsePanel.ActivityList then BrowsePanel.ActivityList:Refresh() end
```

- [ ] **Step 3: Commit**

```bash
git add MeetingStone_Blacklist/Core.lua
git commit -m "feat: add ApplyBlacklistMark - red overlay for blacklisted group rows"
```

---

## Task 7: Blacklist Management Panel

**Files:**
- Modify: `MeetingStone_Blacklist/BlacklistPanel.lua`

- [ ] **Step 1: Implement the full BlacklistPanel.lua**

Replace the placeholder with:

```lua
-- BlacklistPanel.lua
local BL = MeetingStone_Blacklist
local GUI = LibStub('NetEaseGUI-2.0')
local MS  = LibStub('AceAddon-3.0'):GetAddon('MeetingStone')

BlacklistPanel = {}
local BP = BlacklistPanel

function BL:SetupPanel()
    local panel = CreateFrame('Frame')
    GUI:Embed(panel, 'Tab')
    MainPanel:RegisterPanel('黑名单', panel, {after = '屏蔽玩家列表'})

    local list = GUI:GetClass('DataGridView'):New(panel)
    do
        list:SetAllPoints(panel)
        list:SetItemHighlightWithoutChecked(true)
        list:SetItemHeight(32)
        list:SetItemSpacing(1)
        list:SetItemClass(MS:GetClass('BrowseItem'))
        list:SetSelectMode('RADIO')
        list:SetScrollStep(9)

        BP.checkboxes = {}

        list:InitHeader({
            {
                key = '@',
                text = '@',
                width = 30,
                enableMouse = true,
                class = MS:GetClass('CheckBox'),
                formatHandler = function(grid, entry)
                    grid:SetHeight(30)
                    grid.Check:SetSize(32, 32)
                    grid.Check:SetPoint('CENTER')
                    grid.Check:SetChecked(entry.selected)
                    grid:SetCallback('OnChanged', function(data)
                        if entry then
                            entry.selected = data.Check:GetChecked()
                            BP.checkboxes[data] = true
                        end
                    end)
                end,
            },
            {
                key = 'Name',
                text = '玩家名',
                style = 'LEFT',
                width = 200,
                showHandler = function(entry)
                    return entry.name, NORMAL_FONT_COLOR.r, NORMAL_FONT_COLOR.g, NORMAL_FONT_COLOR.b
                end,
            },
            {
                key = 'Time',
                text = '拉黑时间',
                width = 200,
                showHandler = function(entry)
                    return entry.time
                end,
            },
            {
                key = 'Reason',
                text = '理由',
                width = 350,
                showHandler = function(entry)
                    return entry.reason
                end,
            },
        })

        list:SetHeaderPoint('BOTTOMLEFT', list, 'TOPLEFT', -2, 2)
        list:SetItemList(MEETINGSTONE_BLACKLIST_DB)
    end
    BP.BlacklistList = list

    -- Remove selected button
    local removeBtn = CreateFrame('Button', nil, panel, 'UIPanelButtonTemplate')
    do
        removeBtn:SetSize(120, 22)
        removeBtn:SetPoint('BOTTOM', MainPanel, 'BOTTOM', 0, 4)
        removeBtn:SetText('移除选中玩家')
        removeBtn:SetScript('OnClick', function()
            for i = #MEETINGSTONE_BLACKLIST_DB, 1, -1 do
                local entry = MEETINGSTONE_BLACKLIST_DB[i]
                if entry.selected then
                    BL:Remove(entry.name)
                end
            end
            for cb in pairs(BP.checkboxes) do
                cb.Check:SetChecked(false)
            end
            BP.BlacklistList:Refresh()
        end)
    end

    -- Select all / deselect all button
    local selectAllBtn = CreateFrame('Button', nil, panel)
    do
        selectAllBtn:SetNormalFontObject('GameFontNormalSmall')
        selectAllBtn:SetHighlightFontObject('GameFontHighlightSmall')
        selectAllBtn:SetSize(70, 22)
        selectAllBtn:SetPoint('BOTTOMLEFT', MainPanel, 30, 3)
        selectAllBtn:SetText('全选/取消全选')
        selectAllBtn:RegisterForClicks('anyUp')
        selectAllBtn:SetScript('OnClick', function()
            for _, entry in ipairs(MEETINGSTONE_BLACKLIST_DB) do
                entry.selected = not entry.selected
            end
            BP.BlacklistList:Refresh()
        end)
    end
end
```

- [ ] **Step 2: Wire SetupPanel into BL:OnLogin in Core.lua**

In `Core.lua`, update `BL:OnLogin` to also set up the panel:
```lua
function BL:OnLogin()
    BL:SetupHooks()
    BL:SetupPanel()
end
```

- [ ] **Step 3: Verify the panel appears and works**

```
/reload
```
Open MeetingStone. A new tab "黑名单" should appear in the tab list (after "屏蔽玩家列表").

1. First add a test entry:
   ```
   /run MeetingStone_Blacklist:Add("TestPlayer-TestRealm", "测试理由")
   ```
2. Open "黑名单" tab. The entry should appear in the list with name, time, and reason columns.
3. Tick the checkbox, click "移除选中玩家". Entry disappears from list.
4. Verify data is removed:
   ```
   /run print(#MEETINGSTONE_BLACKLIST_DB)
   ```
   Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add MeetingStone_Blacklist/BlacklistPanel.lua MeetingStone_Blacklist/Core.lua
git commit -m "feat: add 黑名单 management panel tab with view/remove functionality"
```

---

## Task 8: End-to-End Integration & Polish

**Files:**
- Review all files for correctness

- [ ] **Step 1: Full flow test — add via right-click, verify mark, verify panel**

1. `/reload`
2. Open 查找活动, find a group with a visible leader name.
3. Right-click → 加入黑名单 → enter reason → OK.
4. Verify:
   - Chat shows `[黑名单] 已将 Leader-Realm 加入黑名单`
   - The group's row gets a red background overlay
5. Open "黑名单" tab. Verify the entry appears with name, time, and reason.
6. Select the entry, click "移除选中玩家".
7. Switch back to 查找活动. The red overlay should be gone from that group.

- [ ] **Step 2: Verify persistence across reload**

1. Add an entry via right-click.
2. `/reload`
3. Open "黑名单" tab. Entry must still be there (persisted in SavedVariables).
4. Open 查找活动. Red mark must still appear if the group is still listed.

- [ ] **Step 3: Verify MeetingStone works normally without this addon**

1. Disable `MeetingStone_Blacklist` in the addon list.
2. `/reload`
3. Open 查找活动. Browse normally, right-click groups. Confirm no errors, menu still shows original items (whisper/report/cancel).

- [ ] **Step 4: Final commit**

```bash
git add MeetingStone_Blacklist/ MeetingStone/Module/BrowsePanel.lua
git commit -m "feat: MeetingStone_Blacklist - complete blacklist plugin (right-click, mark, panel)"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Right-click 加入黑名单 → Task 4
- ✅ Reason input dialog → Task 5
- ✅ Visual marking of blacklisted rows (leader + all members) → Task 6
- ✅ 黑名单 management panel → Task 7
- ✅ Standalone addon → Task 1
- ✅ Independent from IGNORE_LIST → `MEETINGSTONE_BLACKLIST_DB` separate SavedVariable
- ✅ `{after = '屏蔽玩家列表'}` panel registration → Task 7 Step 1

**Type consistency:**
- `BL:Add` / `BL:Remove` / `BL:IsBlacklisted` / `BL:GetAll` / `BL:ApplyBlacklistMark` / `BL:PromptAddToBlacklist` / `BL:SetupHooks` / `BL:SetupPanel` — all defined, all referenced consistently
- `BrowsePanel.ActivityList` — set in Task 3 Step 1, used in Task 5 Step 1 ✅
- `BP.BlacklistList` — set in Task 7 Step 1, referenced in `PromptAddToBlacklist` ✅
- `MEETINGSTONE_BLACKLIST_DB` — initialized in Task 1, used throughout ✅
- `normalizeName` — local function in Core.lua, used by `Add`, `Remove`, `IsBlacklisted` ✅
