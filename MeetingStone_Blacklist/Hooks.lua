-- Hooks.lua
local BL = MeetingStone_Blacklist

-- Own StaticPopup dialog definition — avoids using GUI:CallInputDialog which
-- has a self.editBox bug (vs self.EditBox) in modern WoW.
StaticPopupDialogs['MEETINGSTONE_BL_INPUT'] = {
    button1 = OKAY,
    button2 = CANCEL,
    hasEditBox = true,
    maxLetters = 200,
    timeout = 0,
    whileDead = 1,
    hideOnEscape = 1,
    text = '',  -- set dynamically in PromptAddToBlacklist
}

function BL:SetupHooks()
    local MS = LibStub('AceAddon-3.0'):GetAddon('MeetingStone')
    local BrowsePanelModule = MS:GetModule('BrowsePanel')
    local GUI = LibStub('NetEaseGUI-2.0')

    -- Hook 1: inject "加入黑名单" into the right-click menu
    BrowsePanelModule.ToggleActivityMenu = function(self, anchor, activity)
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

    -- Store ref for Refresh() and ticker use
    BL._BrowsePanelModule = BrowsePanelModule

    -- Hook 3: append blacklist info to the activity hover tooltip.
    -- MainPanel:OpenActivityTooltip(activity[, tooltip]) calls tooltip:Show() at the
    -- end. We wrap it: after the original Show(), add a separator with the blacklisted
    -- player name(s) and reason, then call Show() again.
    local MainPanel = MS:GetModule('MainPanel')
    local origOpenTooltip = MainPanel.OpenActivityTooltip
    MainPanel.OpenActivityTooltip = function(self, activity, customTooltip)
        origOpenTooltip(self, activity, customTooltip)
        local tt = customTooltip or self.GameTooltip

        -- Collect all blacklisted players in this activity (leader + members)
        local entries = {}
        local leader = activity:GetLeader()
        if leader and BL:IsBlacklisted(leader) then
            table.insert(entries, {name = leader, tag = '队长'})
        end
        for i = 1, activity:GetNumMembers() do
            local info = C_LFGList.GetSearchResultPlayerInfo(activity:GetID(), i)
            if info and info.name and info.name ~= leader and BL:IsBlacklisted(info.name) then
                table.insert(entries, {name = info.name, tag = '成员'})
            end
        end

        if #entries > 0 then
            tt:AddSepatator()
            tt:AddLine('|cffff4444[黑名单]|r')
            for _, e in ipairs(entries) do
                local dbEntry = BL:GetEntry(e.name)
                local reason  = dbEntry and dbEntry.reason ~= '' and dbEntry.reason or '无'
                tt:AddLine(string.format('  %s |cffaaaaaa(%s)|r  理由：|cffffff00%s|r',
                    e.name, e.tag, reason), 1, 1, 1, true)
            end
            tt:Show()
        end
    end

    -- Hook 2: ticker-based mark application.
    -- All class/callback hook approaches proved unreliable because SetCallback
    -- captures function refs at Constructor time and safecall silently swallows errors.
    -- Instead, every 0.2s we directly walk ActivityList.buttons (a plain table field
    -- on ListView) and apply/remove the mark on each visible row.
    C_Timer.NewTicker(0.2, function()
        local al = BrowsePanelModule.ActivityList
        if not (al and al:IsShown()) then return end
        for _, button in ipairs(al.buttons) do
            if button:IsShown() then
                local item = al:GetItem(button:GetID())
                if item then
                    pcall(BL.ApplyBlacklistMark, BL, button, item)
                end
            end
        end
    end)
end

function BL:PromptAddToBlacklist(leader, activity)
    if not leader then return end

    local t = StaticPopupDialogs['MEETINGSTONE_BL_INPUT']
    t.text = string.format('将 |cffffd700%s|r 加入黑名单\n请输入理由（可留空）：', leader)

    local function doAdd(reason)
        BL:Add(leader, reason or '')
        local bpm = BL._BrowsePanelModule
        if bpm and bpm.ActivityList then bpm.ActivityList:Refresh() end
        print('|cffff4444[黑名单]|r 已将 ' .. leader .. ' 加入黑名单')
        if BlacklistPanel and BlacklistPanel.BlacklistList then
            BlacklistPanel.BlacklistList:Refresh()
        end
    end

    t.OnAccept = function(self)
        local eb = self.editBox or self.EditBox
        doAdd(eb and eb:GetText())
    end
    t.EditBoxOnEnterPressed = function(self)
        doAdd(self:GetText())
        self:GetParent():Hide()
    end
    t.OnCancel = function() end

    StaticPopup_Show('MEETINGSTONE_BL_INPUT')
end
