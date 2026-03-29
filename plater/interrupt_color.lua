-- ============================================================
-- Interrupt Color — Plater 打断优先级染色模组
-- 根据怪物 NPC ID 对血条染色，显示需要几人打断
-- ============================================================

-- ============================================================
-- 打断分组数据表
-- 格式：[NPC_ID] = 需要几人打断 (1 / 2 / 3)
-- 添加新怪物只需在这里加一行，例：
--   [12345] = 1,  -- 怪物名（副本名）
--   [67890] = 2,
--   [11111] = 3,
-- ============================================================
local INTERRUPT_LIST = {

}

-- ============================================================
-- 模组定义
-- ============================================================
local mod = {}
mod.name = "打断优先级染色"
mod.author = ""
mod.desc = "根据怪物打断优先级对血条染色：绿=1人，橙=2人，蓝=3人"

mod.Config = {
    {
        key = "enabled",
        type = "toggle",
        default = true,
        name = "启用打断染色",
        desc = "启用后根据怪物打断优先级对血条染色",
    },
    {
        type = "label",
        get = function() return "颜色设置" end,
        text_template = "<size=14><color=FFFF00>%s</color></size>",
    },
    {
        key = "color1",
        type = "color",
        default = {0, 1, 0, 1},
        name = "1人打断颜色",
        desc = "只需1人打断的怪物血条颜色（默认：绿色）",
    },
    {
        key = "color2",
        type = "color",
        default = {1, 0.5, 0, 1},
        name = "2人打断颜色",
        desc = "需要2人打断的怪物血条颜色（默认：橙色）",
    },
    {
        key = "color3",
        type = "color",
        default = {0.2, 0.6, 1, 1},
        name = "3人打断颜色",
        desc = "需要3人打断的怪物血条颜色（默认：蓝色）",
    },
}

-- 从 unitframe 解析 NPC ID
local function GetNPCID(unitframe)
    if not unitframe or not unitframe.unit then return nil end
    local guid = UnitGUID(unitframe.unit)
    if not guid then return nil end
    -- GUID 格式: "Creature-0-XXXX-XXXX-XXXX-NPCID-XXXX"
    local npcID = tonumber(select(6, strsplit("-", guid)))
    return npcID
end

-- 对指定 unitframe 应用染色
local function ApplyColor(unitframe, modConfig)
    if not modConfig["enabled"] then return end

    local npcID = GetNPCID(unitframe)
    if not npcID then return end

    local count = INTERRUPT_LIST[npcID]
    if not count then return end  -- 不在列表里，不处理

    local c = modConfig["color" .. count]
    if not c then return end

    unitframe.healthBar:SetStatusBarColor(c[1], c[2], c[3])
end

function mod:OnShow(unitframe, modConfig)
    ApplyColor(unitframe, modConfig)
end

function mod:OnHealthUpdate(unitframe, modConfig)
    ApplyColor(unitframe, modConfig)
end

function mod:OnHide(unitframe, modConfig)
    -- 隐藏时无需处理，Plater 会自动重置
end

return mod
