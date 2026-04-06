-- Core.lua
MeetingStone_Blacklist = {}
local BL = MeetingStone_Blacklist

-- NOTE: BL.lookup is populated in the ADDON_LOADED handler.
-- Code in Hooks.lua and BlacklistPanel.lua must NOT read BL.lookup
-- at file-load time (before ADDON_LOADED). Only access it from inside
-- event handlers or functions called after ADDON_LOADED fires.
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
