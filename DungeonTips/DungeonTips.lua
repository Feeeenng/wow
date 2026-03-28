-- ============================================
-- 1. 数据配置区
-- ============================================
local DungeonData = {
    -- 副本ID = {尾王前需要的进度, 提示文本}
    [658] = {target = 79.78, tips = "1号前63.45%，2号前79.78%"},   -- 萨隆矿坑
    [2915] = {target = 73.32, tips = "左边打完29.03%；两边打完73.32%"},   -- 节点希纳斯
    [2874] = {target = 89.95, tips = "1号Boss前48.78%，2号Boss前89.95%，尾王通道只打2波不打大怪"},   -- 迈萨拉洞窟
    [2805] = {target = 69.71, tips = "两边打完69.71%"},   -- 风行者之塔
    [2811] = {target = 77.39, tips = "1号带一波小怪打完29.15%，2号48.24%，3号77.39%"},   -- 魔导师平台
    [1753] = {target = 68.66, tips = "1号前21.30%，2号前68.66%"},   -- 执政团之座
    [2526] = {target = 77.17, tips = "打完2号第一个平台只打5只，第二个平台全清，3号Boss前77.17%"},   -- 艾杰斯亚学院
    [1209] = {target = 63.57, tips = "1号前粉三波全清31.55%，2号前55.68%，3号前63.57%"},   -- 通天峰
}

-- ============================================
-- 2. 界面框架创建
-- ============================================
local frame = CreateFrame("Frame", "DungeonTipsFrame", UIParent, "BackdropTemplate")
frame:SetSize(400, 75)
frame:SetPoint("TOP", UIParent, "TOP", 0, -100)

-- 背景
local bg = frame:CreateTexture(nil, "BACKGROUND")
bg:SetAllPoints()
bg:SetColorTexture(0, 0, 0, 0.75)

-- 当前进度显示（大字号）
local currentText = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalHuge")
currentText:SetPoint("TOP", frame, "TOP", 0, -10)
frame.currentText = currentText

-- 目标进度显示（中字号）
local targetText = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
targetText:SetPoint("TOP", currentText, "BOTTOM", 0, -5)
frame.targetText = targetText

-- 提示文字（小字号）
local tipsText = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
tipsText:SetPoint("TOP", targetText, "BOTTOM", 0, -3)
tipsText:SetTextColor(0.7, 0.7, 0.7)
frame.tipsText = tipsText

-- 启用拖动
frame:SetMovable(true)
frame:EnableMouse(true)
frame:RegisterForDrag("LeftButton")
frame:SetScript("OnDragStart", frame.StartMoving)
frame:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, relativePoint, xOfs, yOfs = self:GetPoint()
    DungeonTips_Pos = {point, relativePoint, xOfs, yOfs}
end)

frame:Hide()

-- ============================================
-- 3. 核心功能函数
-- ============================================
local currentInstanceID = nil

-- 更新进度显示
local function UpdateProgress()
    if not currentInstanceID or not DungeonData[currentInstanceID] then
        return
    end

    local criteriaInfo = C_Scenario.GetCriteriaInfo(1)
    if not criteriaInfo then
        frame.currentText:SetText("当前进度: --")
        frame.currentText:SetTextColor(0.5, 0.5, 0.5)
        return
    end

    local currentProgress = criteriaInfo.totalQuantity or 0
    local currentPercent = currentProgress / 100  -- 游戏返回的是百分比*100
    local targetPercent = DungeonData[currentInstanceID].target
    local remaining = targetPercent - currentPercent

    -- 显示当前进度
    frame.currentText:SetText(string.format("当前进度: %.2f%%", currentPercent))

    -- 根据进度设置颜色
    if currentPercent >= targetPercent then
        frame.currentText:SetTextColor(0, 1, 0)  -- 绿色：已达标
        frame.targetText:SetText(string.format("✓ 已达标 (目标: %.2f%%)", targetPercent))
        frame.targetText:SetTextColor(0, 1, 0)
    elseif remaining <= 5 then
        frame.currentText:SetTextColor(1, 1, 0)  -- 黄色：接近目标
        frame.targetText:SetText(string.format("还差 %.2f%% (目标: %.2f%%)", remaining, targetPercent))
        frame.targetText:SetTextColor(1, 1, 0)
    else
        frame.currentText:SetTextColor(1, 0.5, 0)  -- 橙色：进行中
        frame.targetText:SetText(string.format("还差 %.2f%% (目标: %.2f%%)", remaining, targetPercent))
        frame.targetText:SetTextColor(1, 0.5, 0)
    end
end

-- 检查并显示副本信息
local function CheckDungeon()
    local _, _, _, _, _, _, _, instanceID = GetInstanceInfo()

    if instanceID and DungeonData[instanceID] then
        currentInstanceID = instanceID

        -- 设置提示文字
        frame.tipsText:SetText(DungeonData[instanceID].tips)

        -- 调整窗口宽度
        local textWidth = math.max(
            frame.currentText:GetStringWidth(),
            frame.targetText:GetStringWidth(),
            frame.tipsText:GetStringWidth()
        )
        frame:SetWidth(math.max(textWidth + 40, 400))

        frame:Show()
        UpdateProgress()
    else
        currentInstanceID = nil
        frame:Hide()
    end
end

-- ============================================
-- 4. 事件处理
-- ============================================
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
frame:RegisterEvent("SCENARIO_UPDATE")
frame:RegisterEvent("SCENARIO_CRITERIA_UPDATE")

frame:SetScript("OnEvent", function(self, event, arg1)
    if event == "ADDON_LOADED" and arg1 == "DungeonTips" then
        -- 加载保存的位置
        if DungeonTips_Pos then
            self:ClearAllPoints()
            self:SetPoint(DungeonTips_Pos[1], UIParent, DungeonTips_Pos[2], DungeonTips_Pos[3], DungeonTips_Pos[4])
        end
    elseif event == "SCENARIO_UPDATE" or event == "SCENARIO_CRITERIA_UPDATE" then
        UpdateProgress()
    else
        CheckDungeon()
    end
end)

-- 定时更新（每0.5秒）
local updateTimer = 0
frame:SetScript("OnUpdate", function(self, elapsed)
    if not self:IsVisible() then return end

    updateTimer = updateTimer + elapsed
    if updateTimer >= 0.5 then
        UpdateProgress()
        updateTimer = 0
    end
end)
