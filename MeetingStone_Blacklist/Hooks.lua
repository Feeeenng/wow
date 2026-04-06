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

    -- Hook 2: apply visual mark on row render by hooking DataGridView.OnItemFormatted.
    -- Compare self == BrowsePanelModule.ActivityList (the stored WoW frame ref) to
    -- target only the ActivityList. GetParent() returns a userdata that won't equal
    -- an Ace module table, so parent-check never works.
    local DGV = GUI:GetClass('DataGridView')
    local origOnItemFormatted = DGV.OnItemFormatted
    DGV.OnItemFormatted = function(self, button, item)
        origOnItemFormatted(self, button, item)
        if self == BrowsePanelModule.ActivityList and item then
            BL:ApplyBlacklistMark(button, item)
        end
    end

    -- Store module ref so PromptAddToBlacklist can call ActivityList:Refresh()
    BL._BrowsePanelModule = BrowsePanelModule
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
