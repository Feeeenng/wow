-- Hooks.lua
local BL = MeetingStone_Blacklist

function BL:SetupHooks()
    local MS = LibStub('AceAddon-3.0'):GetAddon('MeetingStone')
    local BrowsePanel = MS:GetModule('BrowsePanel')
    local GUI = LibStub('NetEaseGUI-2.0')

    BrowsePanel.ToggleActivityMenu = function(self, anchor, activity)
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

    -- store reference for use in PromptAddToBlacklist
    BL._BrowsePanel = BrowsePanel
end

function BL:PromptAddToBlacklist(leader, activity)
    if not leader then return end
    local GUI = LibStub('NetEaseGUI-2.0')

    GUI:CallInputDialog(
        '将 |cffffd700' .. leader .. '|r 加入黑名单\n请输入理由（可留空）：',
        function(confirmed, inputText)
            if not confirmed then return end
            BL:Add(leader, inputText or '')
            -- Refresh the browse list so mark appears immediately
            local bp = BL._BrowsePanel
            if bp and bp.ActivityList then
                bp.ActivityList:Refresh()
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
