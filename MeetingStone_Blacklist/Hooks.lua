-- Hooks.lua
local BL = MeetingStone_Blacklist

function BL:SetupHooks()
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
end
