local ADDON_NAME = ...

local DEFAULTS = {
    enabled = true,
    point = "CENTER",
    relativePoint = "CENTER",
    x = 0,
    y = 180,
    locked = false,
    sound = true,
    soundKey = "raid_warning",
    combatOnly = true,
}

local SCAN_INTERVAL = 0.20
local SOUND_COOLDOWN = 2.50

local BUILTIN_SOUND_OPTIONS = {
    { key = "cat_meow", name = "小猫叫", keywords = { "CAT", "MEOW", "KITTY", "KITTEN" }, fallbackSoundKit = "RAID_WARNING" },
    { key = "dog_bark", name = "小狗叫", keywords = { "DOG", "BARK", "WOLF" }, fallbackSoundKit = "RAID_WARNING" },
    { key = "bird", name = "鸟叫", keywords = { "BIRD", "RAVEN", "CROW" }, fallbackSoundKit = "RAID_WARNING" },
    { key = "sheep", name = "羊叫", keywords = { "SHEEP", "LAMB" }, fallbackSoundKit = "RAID_WARNING" },
    { key = "chicken", name = "鸡叫", keywords = { "CHICKEN", "ROOSTER" }, fallbackSoundKit = "RAID_WARNING" },
    { key = "raid_warning", name = "团队警告", soundKit = "RAID_WARNING" },
    { key = "ready_check", name = "准备确认", soundKit = "READY_CHECK" },
    { key = "bn_toast", name = "战网提示", soundKit = "UI_BNET_TOAST" },
    { key = "checkbox_on", name = "按钮确认", soundKit = "IG_MAINMENU_OPTION_CHECKBOX_ON" },
    { key = "map_ping", name = "地图标记", soundKit = "MAP_PING" },
    { key = "tell_message", name = "密语提示", soundKit = "TELL_MESSAGE" },
    { key = "loot_coin", name = "金币声", soundKit = "LOOT_WINDOW_COIN_SOUND" },
    { key = "auction_open", name = "拍卖行打开", soundKit = "AUCTION_WINDOW_OPEN" },
    { key = "quest_open", name = "任务打开", soundKit = "IG_QUEST_LIST_OPEN" },
}

local SOUND_OPTIONS = {}
local SOUND_OPTION_BY_KEY = {}
local resolvedSoundIDs = {}
local sharedMedia
local soundOptionsBuilt = false

local addon = CreateFrame("Frame")
local alertFrame
local alertText
local settingsPanel
local settingsCategory
local statusText
local positionButton
local soundDropdown
local soundSearchBox
local soundListFrame
local soundSlider
local soundCountText
local optionControls = {}
local scanUnits = {}
local watcherNames = {}
local currentWatchers = {}
local displayLines = {}
local soundListButtons = {}
local filteredSoundIndexes = {}
local displayNameCache = {}
local previousWatchers = {}
local elapsedSinceScan = 0
local lastSoundAt = 0
local soundListOffset = 0
local initialized = false
local positioning = false
local lastDisplayText = nil
local refreshedSoundsAfterLogin = false
local RefreshOptionsPanel
local UpdatePollingState
local GetSelectedSoundIndex
local RebuildFilteredSoundIndexes
local UpdateSoundListRows

local SOUND_VISIBLE_ROWS = 10
local SOUND_ROW_HEIGHT = 20

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

local function AddSoundOption(option)
    SOUND_OPTIONS[#SOUND_OPTIONS + 1] = option
    SOUND_OPTION_BY_KEY[option.key] = option
end

local function GetSharedMedia()
    if sharedMedia then
        return sharedMedia
    end

    if LibStub then
        sharedMedia = LibStub("LibSharedMedia-3.0", true)
    end

    return sharedMedia
end

local function RebuildSoundOptions(force)
    if soundOptionsBuilt and not force then
        return
    end

    wipe(SOUND_OPTIONS)
    wipe(SOUND_OPTION_BY_KEY)
    wipe(filteredSoundIndexes)

    local lsm = GetSharedMedia()
    if lsm and lsm.List and lsm.Fetch then
        local soundNames = lsm:List("sound")

        if soundNames then
            for _, name in ipairs(soundNames) do
                AddSoundOption({
                    key = "lsm:" .. name,
                    name = name,
                    lsmName = name,
                })
            end
        end
    end

    for _, option in ipairs(BUILTIN_SOUND_OPTIONS) do
        AddSoundOption(option)
    end

    soundOptionsBuilt = true
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

local function ResizeAlertFrame(lineCount)
    local width = math.min(math.max(alertText:GetStringWidth() + 16, 160), 760)
    local lineHeight = alertText:GetLineHeight() or 18
    local height = math.max((lineCount or 1) * lineHeight + 8, 28)

    alertFrame:SetSize(width, height)
    alertText:SetWidth(width)
    alertText:SetHeight(height)
end

local function CreateAlertFrame()
    alertFrame = CreateFrame("Frame", "WhoTargetsMeAlertFrame", UIParent)
    alertFrame:SetSize(360, 40)
    alertFrame:SetFrameStrata("HIGH")
    alertFrame:SetClampedToScreen(true)

    alertText = alertFrame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    alertText:SetPoint("CENTER", alertFrame, "CENTER", 0, 0)
    alertText:SetJustifyH("CENTER")
    alertText:SetJustifyV("MIDDLE")
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
    if not WhoTargetsMeDB.enabled then
        return false
    end

    if WhoTargetsMeDB.combatOnly and not UnitAffectingCombat("player") then
        return false
    end

    return IsInGroup()
end

local function BuildScanUnits()
    wipe(scanUnits)
    wipe(displayNameCache)

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

local function GetDisplayName(unit, guid)
    if guid and displayNameCache[guid] then
        return displayNameCache[guid]
    end

    local name = UnitName(unit) or unit

    if Ambiguate then
        name = Ambiguate(name, "short")
    end

    local _, classFile = UnitClass(unit)
    local classColor = classFile and RAID_CLASS_COLORS and RAID_CLASS_COLORS[classFile]

    if classColor and classColor.colorStr then
        name = "|c" .. classColor.colorStr .. name .. "|r"
    end

    if guid then
        displayNameCache[guid] = name
    end

    return name
end

local function GetSelectedSoundOption()
    if not soundOptionsBuilt then
        RebuildSoundOptions()
    end

    return SOUND_OPTION_BY_KEY[WhoTargetsMeDB.soundKey] or SOUND_OPTIONS[1]
end

local function FindSoundIDByKeywords(keywords)
    if not SOUNDKIT or not keywords then
        return nil
    end

    for soundKitName, soundID in pairs(SOUNDKIT) do
        if type(soundKitName) == "string" and type(soundID) == "number" then
            local upperName = string.upper(soundKitName)

            for _, keyword in ipairs(keywords) do
                if string.find(upperName, keyword, 1, true) then
                    return soundID
                end
            end
        end
    end

    return nil
end

local function ResolveSoundID(option)
    if not option then
        return nil
    end

    if resolvedSoundIDs[option.key] ~= nil then
        return resolvedSoundIDs[option.key]
    end

    local soundID

    if option.soundKit and SOUNDKIT then
        soundID = SOUNDKIT[option.soundKit]
    end

    if not soundID then
        soundID = FindSoundIDByKeywords(option.keywords)
    end

    if not soundID and option.fallbackSoundKit and SOUNDKIT then
        soundID = SOUNDKIT[option.fallbackSoundKit]
    end

    resolvedSoundIDs[option.key] = soundID or false
    return soundID
end

local function PlayAlertSound(force)
    if not WhoTargetsMeDB.sound then
        return
    end

    local now = GetTime()
    if not force and now - lastSoundAt < SOUND_COOLDOWN then
        return
    end

    lastSoundAt = now
    local option = GetSelectedSoundOption()

    if option and option.lsmName then
        local lsm = GetSharedMedia()
        local soundFile = lsm and lsm.Fetch and lsm:Fetch("sound", option.lsmName, true)

        if soundFile then
            PlaySoundFile(soundFile, "Master")
            return
        end
    end

    local soundID = ResolveSoundID(option)

    if soundID then
        PlaySound(soundID, "Master")
    elseif SOUNDKIT and SOUNDKIT.RAID_WARNING then
        PlaySound(SOUNDKIT.RAID_WARNING, "Master")
    else
        PlaySound(8959, "Master")
    end
end

local function ShowWatchers(watcherCount)
    if positioning then
        return
    end

    wipe(displayLines)
    displayLines[1] = "|cffffcc00正在看你|r"

    for i = 1, watcherCount do
        displayLines[i + 1] = watcherNames[i]
    end

    local text = table.concat(displayLines, "\n")

    if text ~= lastDisplayText then
        alertText:SetText(text)
        ResizeAlertFrame(watcherCount + 1)
        lastDisplayText = text
    end

    if not alertFrame:IsShown() then
        alertFrame:Show()
    end
end

local function HideWatchers(force)
    if positioning and not force then
        return
    end

    if alertFrame:IsShown() then
        alertFrame:Hide()
    end

    lastDisplayText = nil
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

    wipe(watcherNames)
    wipe(currentWatchers)

    local watcherCount = 0
    local hasNewWatcher = false
    local hasRemovedWatcher = false

    for _, unit in ipairs(scanUnits) do
        local targetUnit = unit .. "target"

        if UnitExists(unit) and UnitExists(targetUnit) then
            local ok, result = pcall(function()
                return UnitIsUnit(targetUnit, "player") == true
            end)
            if not ok then
                ok, result = pcall(function()
                    return UnitGUID(targetUnit) == UnitGUID("player")
                end)
            end
            if ok and result then
                local guid = UnitGUID(unit) or unit

                watcherCount = watcherCount + 1
                watcherNames[watcherCount] = GetDisplayName(unit, guid)
                currentWatchers[guid] = true

                if not previousWatchers[guid] then
                    hasNewWatcher = true
                end
            end
        end
    end

    if watcherCount == 0 then
        HideWatchers()
        return
    end

    for guid in pairs(previousWatchers) do
        if not currentWatchers[guid] then
            hasRemovedWatcher = true
            break
        end
    end

    if hasNewWatcher then
        PlayAlertSound()
    end

    wipe(previousWatchers)
    for guid in pairs(currentWatchers) do
        previousWatchers[guid] = true
    end

    if hasNewWatcher or hasRemovedWatcher or not alertFrame:IsShown() then
        ShowWatchers(watcherCount)
    end
end

local function ResetPosition()
    WhoTargetsMeDB.point = DEFAULTS.point
    WhoTargetsMeDB.relativePoint = DEFAULTS.relativePoint
    WhoTargetsMeDB.x = DEFAULTS.x
    WhoTargetsMeDB.y = DEFAULTS.y
    RestorePosition()
end

local function TestAlert()
    local guid = UnitGUID("player") or "test"

    positioning = false
    wipe(watcherNames)
    watcherNames[1] = GetDisplayName("player", guid)
    ShowWatchers(1)
    PlayAlertSound(true)
    RefreshOptionsPanel()

    if C_Timer and C_Timer.After then
        C_Timer.After(3, ScanTargets)
    end
end

local function ShowPositionHelper()
    local text = "|cff66ccff拖动调整提示框位置|r"

    if text ~= lastDisplayText then
        alertText:SetText(text)
        ResizeAlertFrame(1)
        lastDisplayText = text
    end

    alertFrame:Show()
end

local function UpdateStatusText()
    if not statusText then
        return
    end

    local groupType = "未组队"
    if IsInRaid() then
        groupType = "团队"
    elseif IsInGroup() then
        groupType = "小队"
    end

    statusText:SetText(string.format(
        "当前状态: %s | 扫描单位: %d | 显示条件: %s",
        groupType,
        #scanUnits,
        WhoTargetsMeDB.combatOnly and "仅战斗中" or "一直显示"
    ))
end

local function RefreshSoundDropdown()
    if not soundDropdown then
        return
    end

    local option = GetSelectedSoundOption()
    local selectedIndex = GetSelectedSoundIndex()
    local selectedPosition = 0

    for i, optionIndex in ipairs(filteredSoundIndexes) do
        if optionIndex == selectedIndex then
            selectedPosition = i
            break
        end
    end

    if soundDropdown.SetText then
        soundDropdown:SetText(option and option.name or "无可用声音")
    end

    if soundCountText then
        if #filteredSoundIndexes > 0 then
            soundCountText:SetText(string.format("%d / %d", math.max(selectedPosition, 1), #filteredSoundIndexes))
        else
            soundCountText:SetText("0 / 0")
        end
    end

    if UpdateSoundListRows then
        UpdateSoundListRows()
    end
end

function RefreshOptionsPanel()
    for _, control in ipairs(optionControls) do
        control:SetChecked(control.getValue())
    end

    if positionButton then
        positionButton:SetText(positioning and "结束调整位置" or "调整提示框位置")
    end

    RefreshSoundDropdown()
    UpdateStatusText()
end

local function SetEnabled(value)
    WhoTargetsMeDB.enabled = value

    if value then
        ScanTargets()
    else
        positioning = false
        HideWatchers(true)
    end

    UpdatePollingState()
end

local function SetLocked(value)
    WhoTargetsMeDB.locked = value
    SetMovable(not value)
end

local function SetPositioning(value)
    positioning = value

    if positioning then
        WhoTargetsMeDB.locked = false
        SetMovable(true)
        ShowPositionHelper()
    else
        ScanTargets()
    end

    UpdatePollingState()
    RefreshOptionsPanel()
end

local function SetCombatOnly(value)
    WhoTargetsMeDB.combatOnly = value
    ScanTargets()
    UpdatePollingState()
end

local function SetSound(value)
    WhoTargetsMeDB.sound = value
end

local function CreateCheckbox(parent, label, tooltipText, x, y, getValue, setValue)
    local checkbox = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    checkbox:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
    checkbox:SetSize(26, 26)
    checkbox.getValue = getValue

    local labelText = checkbox:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    labelText:SetPoint("LEFT", checkbox, "RIGHT", 2, 0)
    labelText:SetText(label)

    checkbox:SetHitRectInsets(0, -labelText:GetStringWidth() - 10, 0, 0)
    checkbox:SetScript("OnClick", function(self)
        setValue(self:GetChecked() and true or false)
        RefreshOptionsPanel()
    end)

    if tooltipText then
        checkbox:SetScript("OnEnter", function(self)
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            GameTooltip:SetText(label, 1, 1, 1)
            GameTooltip:AddLine(tooltipText, nil, nil, nil, true)
            GameTooltip:Show()
        end)

        checkbox:SetScript("OnLeave", function()
            GameTooltip:Hide()
        end)
    end

    optionControls[#optionControls + 1] = checkbox
    return checkbox
end

local function CreatePanelButton(parent, text, x, y, width, onClick)
    local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    button:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
    button:SetSize(width, 26)
    button:SetText(text)
    button:SetScript("OnClick", onClick)
    return button
end

function GetSelectedSoundIndex()
    for i, option in ipairs(SOUND_OPTIONS) do
        if option.key == WhoTargetsMeDB.soundKey then
            return i
        end
    end

    return 1
end

local function SelectSound(key, preview)
    WhoTargetsMeDB.soundKey = key
    RefreshSoundDropdown()

    if preview then
        PlayAlertSound(true)
    end
end

local function GetSoundFilter()
    if not soundSearchBox then
        return ""
    end

    return strtrim(soundSearchBox:GetText() or "")
end

function RebuildFilteredSoundIndexes()
    wipe(filteredSoundIndexes)

    local filter = string.lower(GetSoundFilter())

    for i, option in ipairs(SOUND_OPTIONS) do
        if filter == "" or string.find(string.lower(option.name), filter, 1, true) then
            filteredSoundIndexes[#filteredSoundIndexes + 1] = i
        end
    end
end

local function ApplySoundFilter()
    RebuildFilteredSoundIndexes()
    soundListOffset = 0

    if #filteredSoundIndexes > 0 then
        local currentIndex = GetSelectedSoundIndex()
        local currentVisible = false

        for _, optionIndex in ipairs(filteredSoundIndexes) do
            if optionIndex == currentIndex then
                currentVisible = true
                break
            end
        end

        if not currentVisible then
            local option = SOUND_OPTIONS[filteredSoundIndexes[1]]
            if option then
                WhoTargetsMeDB.soundKey = option.key
            end
        end
    end

    RefreshSoundDropdown()
end

local function ScrollSoundList(delta)
    local maxOffset = math.max(#filteredSoundIndexes - SOUND_VISIBLE_ROWS, 0)
    soundListOffset = math.min(math.max(soundListOffset + delta, 0), maxOffset)

    if soundSlider then
        soundSlider:SetValue(soundListOffset)
    end

    UpdateSoundListRows()
end

function UpdateSoundListRows()
    if not soundListFrame then
        return
    end

    local maxOffset = math.max(#filteredSoundIndexes - SOUND_VISIBLE_ROWS, 0)
    soundListOffset = math.min(math.max(soundListOffset or 0, 0), maxOffset)

    if soundSlider then
        soundSlider:SetMinMaxValues(0, maxOffset)
        soundSlider:SetValueStep(1)
        soundSlider:SetValue(soundListOffset)
        soundSlider:SetShown(maxOffset > 0)
    end

    local selectedKey = WhoTargetsMeDB.soundKey

    for row = 1, SOUND_VISIBLE_ROWS do
        local button = soundListButtons[row]
        local optionIndex = filteredSoundIndexes[soundListOffset + row]
        local option = optionIndex and SOUND_OPTIONS[optionIndex]

        if option then
            button.soundKey = option.key
            button:SetText(option.name)
            button:Show()

            local fontString = button:GetFontString()
            if fontString then
                if option.key == selectedKey then
                    fontString:SetTextColor(1, 0.82, 0)
                else
                    fontString:SetTextColor(1, 1, 1)
                end
            end
        else
            button.soundKey = nil
            button:Hide()
        end
    end
end

local function ToggleSoundList()
    if not soundListFrame then
        return
    end

    if soundListFrame:IsShown() then
        soundListFrame:Hide()
    else
        soundListFrame:Show()
        UpdateSoundListRows()
    end
end

local function CreateSoundSelector(parent, x, y)
    RebuildSoundOptions()
    RebuildFilteredSoundIndexes()

    local label = parent:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    label:SetPoint("TOPLEFT", parent, "TOPLEFT", x, y)
    label:SetText("提示音")

    soundSearchBox = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
    soundSearchBox:SetPoint("TOPLEFT", label, "BOTTOMLEFT", 8, -8)
    soundSearchBox:SetSize(140, 22)
    soundSearchBox:SetAutoFocus(false)
    soundSearchBox:SetText("")
    soundSearchBox:SetScript("OnEnterPressed", function(self)
        ApplySoundFilter()
        self:ClearFocus()
    end)
    soundSearchBox:SetScript("OnEscapePressed", function(self)
        self:SetText("")
        ApplySoundFilter()
        self:ClearFocus()
    end)

    CreatePanelButton(parent, "筛选", x + 158, y - 28, 56, function()
        ApplySoundFilter()
    end)

    CreatePanelButton(parent, "刷新", x + 220, y - 28, 56, function()
        RebuildSoundOptions(true)
        ApplySoundFilter()
    end)

    soundDropdown = CreatePanelButton(parent, "", x, y - 62, 278, function()
        ToggleSoundList()
    end)

    soundCountText = parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    soundCountText:SetPoint("LEFT", soundDropdown, "RIGHT", 8, 0)

    soundListFrame = CreateFrame("Frame", nil, parent, "BackdropTemplate")
    soundListFrame:SetPoint("TOPLEFT", soundDropdown, "BOTTOMLEFT", 0, -2)
    soundListFrame:SetSize(300, SOUND_VISIBLE_ROWS * SOUND_ROW_HEIGHT + 6)
    soundListFrame:SetFrameStrata("DIALOG")
    soundListFrame:EnableMouseWheel(true)
    soundListFrame:SetScript("OnMouseWheel", function(_, delta)
        ScrollSoundList(delta > 0 and -1 or 1)
    end)

    if soundListFrame.SetBackdrop then
        soundListFrame:SetBackdrop({
            bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
            edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
            tile = true,
            tileSize = 16,
            edgeSize = 12,
            insets = { left = 3, right = 3, top = 3, bottom = 3 },
        })
        soundListFrame:SetBackdropColor(0, 0, 0, 0.92)
    end

    for row = 1, SOUND_VISIBLE_ROWS do
        local button = CreateFrame("Button", nil, soundListFrame)
        button:SetPoint("TOPLEFT", soundListFrame, "TOPLEFT", 6, -3 - (row - 1) * SOUND_ROW_HEIGHT)
        button:SetSize(260, SOUND_ROW_HEIGHT)

        local text = button:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
        text:SetPoint("LEFT", button, "LEFT", 4, 0)
        text:SetPoint("RIGHT", button, "RIGHT", -4, 0)
        text:SetJustifyH("LEFT")
        button:SetFontString(text)

        local highlight = button:CreateTexture(nil, "HIGHLIGHT")
        highlight:SetAllPoints()
        highlight:SetColorTexture(1, 1, 1, 0.12)

        button:SetScript("OnClick", function(self)
            if self.soundKey then
                SelectSound(self.soundKey, true)
                soundListFrame:Hide()
            end
        end)

        soundListButtons[row] = button
    end

    soundSlider = CreateFrame("Slider", "WhoTargetsMeSoundSlider", soundListFrame, "OptionsSliderTemplate")
    soundSlider:SetOrientation("VERTICAL")
    soundSlider:SetPoint("TOPRIGHT", soundListFrame, "TOPRIGHT", -10, -8)
    soundSlider:SetPoint("BOTTOMRIGHT", soundListFrame, "BOTTOMRIGHT", -10, 8)
    soundSlider:SetWidth(16)
    soundSlider:SetScript("OnValueChanged", function(_, value)
        local offset = math.floor(value + 0.5)
        if offset ~= soundListOffset then
            soundListOffset = offset
            UpdateSoundListRows()
        end
    end)
    soundListFrame:Hide()

    RefreshSoundDropdown()
    return soundDropdown
end

local function CreateSettingsPanel()
    if settingsPanel then
        return
    end

    settingsPanel = CreateFrame("Frame", "WhoTargetsMeOptionsPanel")
    settingsPanel.name = "谁在看我"

    local title = settingsPanel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", settingsPanel, "TOPLEFT", 16, -16)
    title:SetText("谁在看我")

    local description = settingsPanel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    description:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -10)
    description:SetPoint("RIGHT", settingsPanel, "RIGHT", -24, 0)
    description:SetJustifyH("LEFT")
    description:SetText("战斗中扫描小队/团队成员的目标，显示当前正在目标你的队友。")

    CreateCheckbox(
        settingsPanel,
        "仅战斗中显示",
        "开启后，只有你进入战斗时才显示谁正在目标你。",
        18,
        -76,
        function() return WhoTargetsMeDB.combatOnly end,
        SetCombatOnly
    )

    CreateCheckbox(
        settingsPanel,
        "播放提示音",
        "有新的队友开始目标你时播放当前选择的系统提示音。",
        18,
        -112,
        function() return WhoTargetsMeDB.sound end,
        SetSound
    )

    CreateSoundSelector(settingsPanel, 46, -148)

    local soundNote = settingsPanel:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    soundNote:SetPoint("TOPLEFT", settingsPanel, "TOPLEFT", 46, -238)
    soundNote:SetText("优先读取 LibSharedMedia-3.0 的共享声音；没有共享媒体时使用内置回退声音。")

    CreateCheckbox(
        settingsPanel,
        "锁定提示框位置",
        "关闭锁定后，可以用鼠标左键拖动屏幕上的提示框。",
        18,
        -268,
        function() return WhoTargetsMeDB.locked end,
        SetLocked
    )

    positionButton = CreatePanelButton(settingsPanel, "调整提示框位置", 46, -304, 150, function()
        SetPositioning(not positioning)
    end)

    CreatePanelButton(settingsPanel, "测试提示", 18, -354, 110, function()
        TestAlert()
    end)

    CreatePanelButton(settingsPanel, "重置提示框位置", 140, -354, 140, function()
        ResetPosition()
        Print("位置已重置。")
    end)

    CreatePanelButton(settingsPanel, "重新扫描", 292, -354, 110, function()
        BuildScanUnits()
        ScanTargets()
        RefreshOptionsPanel()
    end)

    statusText = settingsPanel:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    statusText:SetPoint("TOPLEFT", settingsPanel, "TOPLEFT", 18, -402)
    statusText:SetPoint("RIGHT", settingsPanel, "RIGHT", -24, 0)
    statusText:SetJustifyH("LEFT")

    settingsPanel:SetScript("OnShow", RefreshOptionsPanel)
end

local function RegisterSettingsPanel()
    CreateSettingsPanel()

    if Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory then
        settingsCategory = Settings.RegisterCanvasLayoutCategory(settingsPanel, settingsPanel.name)
        Settings.RegisterAddOnCategory(settingsCategory)
    elseif InterfaceOptions_AddCategory then
        InterfaceOptions_AddCategory(settingsPanel)
    end
end

local function OpenSettingsPanel()
    RebuildSoundOptions()
    RefreshOptionsPanel()

    if Settings and Settings.OpenToCategory and settingsCategory then
        local categoryID = settingsCategory.GetID and settingsCategory:GetID() or settingsCategory.ID
        local opened = categoryID and pcall(Settings.OpenToCategory, categoryID)

        if opened then
            return
        end

        opened = pcall(Settings.OpenToCategory, settingsCategory)

        if opened then
            return
        end
    end

    if InterfaceOptionsFrame_OpenToCategory and settingsPanel then
        InterfaceOptionsFrame_OpenToCategory(settingsPanel)
        InterfaceOptionsFrame_OpenToCategory(settingsPanel)
    else
        Print("无法打开系统设置面板，请使用 /wtm 命令查看可用控制。")
    end
end

local function PrintHelp()
    Print("/wtm - 打开设置面板")
    Print("/wtm lock - 锁定或解锁位置")
    Print("/wtm sound - 开关提示音")
    Print("/wtm always - 开关非战斗显示")
    Print("/wtm move - 显示或隐藏位置调整文字")
    Print("/wtm test - 测试显示和声音")
    Print("/wtm reset - 重置位置")
end

local function RegisterSlashCommands()
    SLASH_WHOTARGETSME1 = "/wtm"
    SLASH_WHOTARGETSME2 = "/whotargetsme"

    SlashCmdList.WHOTARGETSME = function(input)
        local command = string.lower(strtrim(input or ""))

        if command == "" or command == "config" or command == "options" then
            OpenSettingsPanel()
        elseif command == "enable" then
            SetEnabled(not WhoTargetsMeDB.enabled)
            Print(WhoTargetsMeDB.enabled and "插件已启用。" or "插件已关闭。")
            RefreshOptionsPanel()
        elseif command == "lock" then
            SetLocked(not WhoTargetsMeDB.locked)
            Print(WhoTargetsMeDB.locked and "已锁定位置。" or "已解锁位置，可拖动提示框。")
        elseif command == "sound" then
            SetSound(not WhoTargetsMeDB.sound)
            Print(WhoTargetsMeDB.sound and "提示音已开启。" or "提示音已关闭。")
        elseif command == "always" then
            SetCombatOnly(not WhoTargetsMeDB.combatOnly)
            Print(WhoTargetsMeDB.combatOnly and "仅战斗中显示。" or "非战斗也会显示。")
        elseif command == "move" or command == "position" or command == "unlock" then
            SetPositioning(not positioning)
            Print(positioning and "已显示位置调整文字，可直接拖动。" or "已结束位置调整。")
        elseif command == "test" then
            TestAlert()
        elseif command == "reset" then
            ResetPosition()
            Print("位置已重置。")
        else
            PrintHelp()
        end
    end
end

local function PollTargets(_, elapsed)
    elapsedSinceScan = elapsedSinceScan + elapsed
    if elapsedSinceScan < SCAN_INTERVAL then
        return
    end

    elapsedSinceScan = 0
    ScanTargets()
end

function UpdatePollingState()
    if not initialized then
        return
    end

    local shouldPoll = WhoTargetsMeDB.enabled
        and IsInGroup()
        and not positioning
        and (not WhoTargetsMeDB.combatOnly or UnitAffectingCombat("player"))

    if shouldPoll then
        addon:SetScript("OnUpdate", PollTargets)
    else
        addon:SetScript("OnUpdate", nil)
        elapsedSinceScan = 0
    end
end

addon:SetScript("OnEvent", function(_, event, ...)
    if event == "ADDON_LOADED" then
        local loadedAddon = ...
        if loadedAddon ~= ADDON_NAME then
            return
        end

        CopyDefaults()
        RebuildSoundOptions()
        CreateAlertFrame()
        RegisterSettingsPanel()
        RegisterSlashCommands()
        BuildScanUnits()
        initialized = true
        ScanTargets()
        UpdatePollingState()
        return
    end

    if not initialized then
        return
    end

    if event == "GROUP_ROSTER_UPDATE" or event == "PLAYER_ENTERING_WORLD" then
        if event == "PLAYER_ENTERING_WORLD" and not refreshedSoundsAfterLogin then
            RebuildSoundOptions(true)
            ApplySoundFilter()
            refreshedSoundsAfterLogin = true
        end

        RebuildSoundOptions()
        BuildScanUnits()
        ScanTargets()
        UpdatePollingState()
        RefreshOptionsPanel()
    elseif event == "PLAYER_REGEN_DISABLED" then
        ResetPreviousWatchers()
        ScanTargets()
        UpdatePollingState()
    elseif event == "PLAYER_REGEN_ENABLED" then
        if WhoTargetsMeDB.combatOnly then
            HideWatchers()
        else
            ScanTargets()
        end
        UpdatePollingState()
    elseif event == "UNIT_TARGET" then
        local unit = ...
        if unit and (unit:match("^party%d+$") or unit:match("^raid%d+$")) then
            elapsedSinceScan = SCAN_INTERVAL
        end
    end
end)

addon:RegisterEvent("ADDON_LOADED")
addon:RegisterEvent("PLAYER_ENTERING_WORLD")
addon:RegisterEvent("GROUP_ROSTER_UPDATE")
addon:RegisterEvent("PLAYER_REGEN_DISABLED")
addon:RegisterEvent("PLAYER_REGEN_ENABLED")
addon:RegisterEvent("UNIT_TARGET")
