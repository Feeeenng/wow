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

    -- Hook 2: hook BrowseItem.FireFormat at the class level.
    -- ListView:UpdateItems() calls button:FireFormat() directly as a method call
    -- (not via the callback/Fire system). Class-level method hooking is reliable here
    -- because instance lookup goes: instance → BrowseItem class → ItemButton class.
    -- Setting BrowseItem.FireFormat shadows ItemButton.FireFormat for all instances.
    local BrowseItem = MS:GetClass('BrowseItem')
    local origFireFormat = BrowseItem.FireFormat
    BrowseItem.FireFormat = function(self)
        origFireFormat(self)
        local owner = self:GetOwner()
        if owner and owner == BrowsePanelModule.ActivityList then
            local item = owner:GetItem(self:GetID())
            if item then
                BL:ApplyBlacklistMark(self, item)
            end
        end
    end

    -- Store ref for Refresh() calls after blacklisting
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
