local ADDON_NAME = ...

local DEFAULTS = {
    point = "CENTER",
    relativePoint = "CENTER",
    x = 0,
    y = 180,
    locked = false,
    sound = true,
    combatOnly = true,
}

local SCAN_INTERVAL = 0.20
local SOUND_COOLDOWN = 2.50
local DISPLAY_LIMIT = 6

local addon = CreateFrame("Frame")
local alertFrame
local alertText
local scanUnits = {}
local previousWatchers = {}
local elapsedSinceScan = 0
local lastSoundAt = 0
local initialized = false

local function CopyDefaults()
    WhoTargetsMeDB = WhoTargetsMeDB or {}

    for key, value in pairs(DEFAULTS) do
        if WhoTargetsMeDB[key] == nil then
            WhoTargetsMeDB[key] = value
        end
    end
end

local function Print(message)
    DEFAULT_CHAT_FRAME:AddMessage("|cff66ccffWhoTargetsMe|r: " .. message)
end

local function ResetPreviousWatchers()
    wipe(previousWatchers)
end

local function SavePosition()
    local point, _, relativePoint, x, y = alertFrame:GetPoint(1)
    WhoTargetsMeDB.point = point
    WhoTargetsMeDB.relativePoint = relativePoint
    WhoTargetsMeDB.x = x
    WhoTargetsMeDB.y = y
end

local function RestorePosition()
    alertFrame:ClearAllPoints()
    alertFrame:SetPoint(
        WhoTargetsMeDB.point,
        UIParent,
        WhoTargetsMeDB.relativePoint,
        WhoTargetsMeDB.x,
        WhoTargetsMeDB.y
    )
end

local function SetMovable(enabled)
    alertFrame:SetMovable(enabled)
    alertFrame:EnableMouse(enabled)
    alertFrame:RegisterForDrag("LeftButton")
end

local function CreateAlertFrame()
    alertFrame = CreateFrame("Frame", "WhoTargetsMeAlertFrame", UIParent)
    alertFrame:SetSize(360, 46)
    alertFrame:SetFrameStrata("HIGH")
    alertFrame:SetClampedToScreen(true)

    local background = alertFrame:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetColorTexture(0.05, 0.05, 0.05, 0.82)

    local accent = alertFrame:CreateTexture(nil, "ARTWORK")
    accent:SetPoint("TOPLEFT")
    accent:SetPoint("TOPRIGHT")
    accent:SetHeight(3)
    accent:SetColorTexture(1, 0.15, 0.10, 1)

    alertText = alertFrame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    alertText:SetPoint("CENTER", alertFrame, "CENTER", 0, -1)
    alertText:SetJustifyH("CENTER")
    alertText:SetTextColor(1, 0.92, 0.25)
    alertText:SetWordWrap(false)
    alertText:SetText("正在看你")

    alertFrame:SetScript("OnDragStart", function(self)
        if not WhoTargetsMeDB.locked then
            self:StartMoving()
        end
    end)

    alertFrame:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        SavePosition()
    end)

    RestorePosition()
    SetMovable(not WhoTargetsMeDB.locked)
    alertFrame:Hide()
end

local function IsActive()
    if WhoTargetsMeDB.combatOnly and not UnitAffectingCombat("player") then
        return false
    end

    return IsInGroup()
end

local function BuildScanUnits()
    wipe(scanUnits)

    if IsInRaid() then
        local members = GetNumGroupMembers()
        for i = 1, members do
            local unit = "raid" .. i
            if UnitExists(unit) and not UnitIsUnit(unit, "player") then
                scanUnits[#scanUnits + 1] = unit
            end
        end
    elseif IsInGroup() then
        local members = GetNumSubgroupMembers()
        for i = 1, members do
            local unit = "party" .. i
            if UnitExists(unit) then
                scanUnits[#scanUnits + 1] = unit
            end
        end
    end
end

local function GetDisplayName(unit)
    local name = UnitName(unit) or unit

    if Ambiguate then
        name = Ambiguate(name, "short")
    end

    local _, classFile = UnitClass(unit)
    local classColor = classFile and RAID_CLASS_COLORS and RAID_CLASS_COLORS[classFile]

    if classColor and classColor.colorStr then
        return "|c" .. classColor.colorStr .. name .. "|r"
    end

    return name
end

local function PlayAlertSound()
    if not WhoTargetsMeDB.sound then
        return
    end

    local now = GetTime()
    if now - lastSoundAt < SOUND_COOLDOWN then
        return
    end

    lastSoundAt = now

    if SOUNDKIT and SOUNDKIT.RAID_WARNING then
        PlaySound(SOUNDKIT.RAID_WARNING, "Master")
    else
        PlaySound(8959, "Master")
    end
end

local function ShowWatchers(watchers)
    local names = {}
    local maxNames = math.min(#watchers, DISPLAY_LIMIT)

    for i = 1, maxNames do
        names[#names + 1] = watchers[i].name
    end

    if #watchers > DISPLAY_LIMIT then
        names[#names + 1] = string.format("等%d人", #watchers - DISPLAY_LIMIT)
    end

    alertText:SetText("正在看你: " .. table.concat(names, ", "))

    local width = math.min(math.max(alertText:GetStringWidth() + 48, 300), 760)
    alertFrame:SetWidth(width)
    alertFrame:Show()
end

local function HideWatchers()
    alertFrame:Hide()
    ResetPreviousWatchers()
end

local function ScanTargets()
    if not initialized then
        return
    end

    if not IsActive() then
        HideWatchers()
        return
    end

    local watchers = {}
    local currentWatchers = {}
    local hasNewWatcher = false

    for _, unit in ipairs(scanUnits) do
        local targetUnit = unit .. "target"

        if UnitExists(unit) and UnitExists(targetUnit) and UnitIsUnit(targetUnit, "player") then
            local guid = UnitGUID(unit) or unit

            watchers[#watchers + 1] = {
                guid = guid,
                name = GetDisplayName(unit),
            }

            currentWatchers[guid] = true

            if not previousWatchers[guid] then
                hasNewWatcher = true
            end
        end
    end

    if #watchers == 0 then
        HideWatchers()
        return
    end

    if hasNewWatcher then
        PlayAlertSound()
    end

    wipe(previousWatchers)
    for guid in pairs(currentWatchers) do
        previousWatchers[guid] = true
    end

    ShowWatchers(watchers)
end

local function ResetPosition()
    WhoTargetsMeDB.point = DEFAULTS.point
    WhoTargetsMeDB.relativePoint = DEFAULTS.relativePoint
    WhoTargetsMeDB.x = DEFAULTS.x
    WhoTargetsMeDB.y = DEFAULTS.y
    RestorePosition()
end

local function PrintHelp()
    Print("/wtm lock - 锁定或解锁位置")
    Print("/wtm sound - 开关提示音")
    Print("/wtm always - 开关非战斗显示")
    Print("/wtm test - 测试显示和声音")
    Print("/wtm reset - 重置位置")
end

local function RegisterSlashCommands()
    SLASH_WHOTARGETSME1 = "/wtm"
    SLASH_WHOTARGETSME2 = "/whotargetsme"

    SlashCmdList.WHOTARGETSME = function(input)
        local command = string.lower(strtrim(input or ""))

        if command == "lock" then
            WhoTargetsMeDB.locked = not WhoTargetsMeDB.locked
            SetMovable(not WhoTargetsMeDB.locked)
            Print(WhoTargetsMeDB.locked and "已锁定位置。" or "已解锁位置，可拖动提示框。")
        elseif command == "sound" then
            WhoTargetsMeDB.sound = not WhoTargetsMeDB.sound
            Print(WhoTargetsMeDB.sound and "提示音已开启。" or "提示音已关闭。")
        elseif command == "always" then
            WhoTargetsMeDB.combatOnly = not WhoTargetsMeDB.combatOnly
            Print(WhoTargetsMeDB.combatOnly and "仅战斗中显示。" or "非战斗也会显示。")
            ScanTargets()
        elseif command == "test" then
            ShowWatchers({ { guid = "test", name = UnitName("player") or "Player" } })
            PlayAlertSound()
            C_Timer.After(3, ScanTargets)
        elseif command == "reset" then
            ResetPosition()
            Print("位置已重置。")
        else
            PrintHelp()
        end
    end
end

addon:SetScript("OnEvent", function(_, event, ...)
    if event == "ADDON_LOADED" then
        local loadedAddon = ...
        if loadedAddon ~= ADDON_NAME then
            return
        end

        CopyDefaults()
        CreateAlertFrame()
        RegisterSlashCommands()
        BuildScanUnits()
        initialized = true
        ScanTargets()
        return
    end

    if not initialized then
        return
    end

    if event == "GROUP_ROSTER_UPDATE" or event == "PLAYER_ENTERING_WORLD" then
        BuildScanUnits()
        ScanTargets()
    elseif event == "PLAYER_REGEN_DISABLED" then
        ResetPreviousWatchers()
        ScanTargets()
    elseif event == "PLAYER_REGEN_ENABLED" then
        if WhoTargetsMeDB.combatOnly then
            HideWatchers()
        else
            ScanTargets()
        end
    elseif event == "UNIT_TARGET" then
        local unit = ...
        if unit and (unit:match("^party%d+$") or unit:match("^raid%d+$")) then
            ScanTargets()
        end
    end
end)

addon:SetScript("OnUpdate", function(_, elapsed)
    if not initialized then
        return
    end

    elapsedSinceScan = elapsedSinceScan + elapsed
    if elapsedSinceScan < SCAN_INTERVAL then
        return
    end

    elapsedSinceScan = 0
    ScanTargets()
end)

addon:RegisterEvent("ADDON_LOADED")
addon:RegisterEvent("PLAYER_ENTERING_WORLD")
addon:RegisterEvent("GROUP_ROSTER_UPDATE")
addon:RegisterEvent("PLAYER_REGEN_DISABLED")
addon:RegisterEvent("PLAYER_REGEN_ENABLED")
addon:RegisterEvent("UNIT_TARGET")
