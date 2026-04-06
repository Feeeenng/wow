-- Core.lua
MeetingStone_Blacklist = {}
local BL = MeetingStone_Blacklist

-- NOTE: BL.lookup is populated in the ADDON_LOADED handler.
-- Code in Hooks.lua and BlacklistPanel.lua must NOT read BL.lookup
-- at file-load time (before ADDON_LOADED). Only access it from inside
-- event handlers or functions called after ADDON_LOADED fires.
BL.lookup = {}

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
    BL:SetupHooks()
end

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
