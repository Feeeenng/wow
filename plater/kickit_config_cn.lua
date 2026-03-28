-- ============================================
-- Kickit+ 模组配置汉化版
-- ============================================
-- 使用说明：在 Plater 模组的配置定义部分，找到对应的英文配置项，
-- 将 name 和 desc 字段替换为下面的中文版本

local config = {
    -- 次要打断技能ID
    {
        key = "secondaryInterruptIdOverride",
        type = "range",
        usedecimals = false,
        min = 0,
        max = 999999,
        step = 1,
        default = 0,
        name = "次要打断技能ID",
        desc = "手动设置次要打断技能ID（0=自动识别）",
    },

    -- ============================================
    -- 施法目标设置
    -- ============================================
    {
        type = "label",
        get = function() return "施法目标设置" end,
        text_template = "<size=16><color=FFFF00>%s</color></size>",
    },

    {
        key = "includeCastTarget",
        type = "toggle",
        default = true,
        name = "显示施法目标",
        desc = "在施法条上显示敌人的施法目标",
    },

    {
        key = "stickCastTargetToCastName",
        type = "toggle",
        default = true,
        name = "切换：单行|双行显示",
        desc = "true=施法名和目标单行显示，false=分两段显示",
    },

    {
        key = "spellTextToSpellTargetRatio",
        type = "range",
        usedecimals = true,
        min = 0.1,
        max = 0.9,
        step = 0.01,
        default = 0.36,
        name = "施法名称:目标比例",
        desc = "施法名称和目标的宽度比例（仅双行模式）",
    },

    -- ============================================
    -- 打断图标设置
    -- ============================================
    {
        type = "label",
        get = function() return "打断图标设置" end,
        text_template = "<size=16><color=FFFF00>%s</color></size>",
    },

    {
        key = "enableKickIconModule",
        type = "toggle",
        default = true,
        name = "启用打断图标",
        desc = "在施法条上显示打断就绪/冷却图标",
    },

    {
        key = "readyColor",
        type = "color",
        default = {0, 1, 0, 1},
        name = "打断就绪颜色",
        desc = "主打断技能就绪时的图标颜色",
    },

    {
        key = "secondaryReadyColor",
        type = "color",
        default = {1, 0, 1, 1},
        name = "次要打断就绪颜色",
        desc = "次要打断技能就绪时的图标颜色",
    },

    {
        key = "notReadyColor",
        type = "color",
        default = {1, 0, 0, 1},
        name = "打断冷却颜色",
        desc = "打断技能冷却中的图标颜色",
    },

    {
        key = "animateIcon",
        type = "toggle",
        default = true,
        name = "图标动画",
        desc = "打断就绪时播放动画效果",
    },

    {
        key = "iconSizeMatchCastbar",
        type = "toggle",
        default = true,
        name = "图标匹配施法条高度",
        desc = "图标大小自动匹配施法条高度",
    },

    {
        key = "iconSizeOption",
        type = "range",
        usedecimals = false,
        min = 5,
        max = 50,
        step = 1,
        default = 10,
        name = "手动图标大小",
        desc = "手动设置图标大小（像素）",
    },

    {
        key = "anchor",
        type = "select",
        values = function()
            return {
                {value = 1, label = "左上"},
                {value = 2, label = "左侧"},
                {value = 3, label = "左下"},
                {value = 4, label = "底部中央"},
                {value = 5, label = "右下"},
                {value = 6, label = "右侧"},
                {value = 7, label = "右上"},
                {value = 8, label = "顶部中央"},
                {value = 9, label = "内部中央"},
                {value = 10, label = "内部左侧"},
                {value = 11, label = "内部右侧"},
                {value = 12, label = "内部顶部"},
                {value = 13, label = "内部底部"},
            }
        end,
        default = 10,
        name = "锚点位置",
        desc = "图标在施法条的锚点位置",
    },

    {
        key = "xOffset",
        type = "range",
        usedecimals = true,
        min = -50,
        max = 50,
        step = 0.1,
        default = 0,
        name = "水平偏移",
        desc = "图标的水平偏移量",
    },

    {
        key = "yOffset",
        type = "range",
        usedecimals = true,
        min = -50,
        max = 50,
        step = 0.1,
        default = 0,
        name = "垂直偏移",
        desc = "图标的垂直偏移量",
    },

    {
        key = "useIconAnchorForSpellName",
        type = "toggle",
        default = false,
        name = "文字锚点跟随图标",
        desc = "施法文字的锚点跟随图标位置（避免遮挡）",
    },

    -- ============================================
    -- 打断火花设置
    -- ============================================
    {
        type = "label",
        get = function() return "打断火花设置" end,
        text_template = "<size=16><color=FFFF00>%s</color></size>",
    },

    {
        key = "enableKickSparkModule",
        type = "toggle",
        default = true,
        name = "启用打断火花",
        desc = "在施法条上显示打断冷却结束的时间标记",
    },

    {
        key = "kickIndicatorColor",
        type = "color",
        default = {0, 1, 0, 1},
        name = "打断火花颜色",
        desc = "主打断技能火花的颜色",
    },

    {
        key = "secondaryKickIndicatorColor",
        type = "color",
        default = {1, 0, 0, 1},
        name = "次要打断火花颜色",
        desc = "次要打断技能火花的颜色",
    },

    {
        key = "kickIndicatorTextureId",
        type = "select",
        values = function()
            return {
                {value = 1, label = "火花样式 1"},
                {value = 2, label = "火花样式 2"},
                {value = 3, label = "火花样式 3"},
                {value = 4, label = "火花样式 4"},
                {value = 5, label = "火花样式 5"},
                {value = 6, label = "火花样式 6"},
                {value = 7, label = "火花样式 7"},
                {value = 8, label = "火花样式 8"},
                {value = 9, label = "纯色"},
            }
        end,
        default = 2,
        name = "火花纹理",
        desc = "选择火花指示器的纹理样式",
    },

    {
        key = "kickIndicatorWidth",
        type = "range",
        usedecimals = false,
        min = 1,
        max = 20,
        step = 1,
        default = 10,
        name = "火花宽度",
        desc = "火花指示线的宽度",
    },

    -- ============================================
    -- 施法条颜色和边框设置
    -- ============================================
    {
        type = "label",
        get = function() return "施法条颜色和边框设置" end,
        text_template = "<size=16><color=FFFF00>%s</color></size>",
    },

    {
        key = "enableCastbarColorOverridesModule",
        type = "toggle",
        default = true,
        name = "启用施法条颜色覆盖",
        desc = "根据打断状态改变施法条颜色",
    },

    {
        key = "enableCastbarBorderColorModule",
        type = "toggle",
        default = false,
        name = "启用施法条边框颜色",
        desc = "根据打断状态改变施法条边框颜色",
    },

    {
        key = "castbarSecondaryKickReady",
        type = "color",
        default = {1, 0, 1, 1},
        name = "次要打断就绪颜色",
        desc = "仅次要打断就绪时的施法条/边框颜色",
    },

    {
        key = "castbarColorKickNotReady",
        type = "color",
        default = {0, 0, 1, 1},
        name = "无打断就绪颜色",
        desc = "所有打断都冷却时的施法条/边框颜色",
    },

    {
        key = "castbarBorderThickness",
        type = "range",
        usedecimals = false,
        min = 1,
        max = 10,
        step = 1,
        default = 2,
        name = "边框粗细",
        desc = "施法条边框的粗细",
    },

    {
        type = "label",
        get = function() return "提示：打断就绪且法术可打断时，使用配置文件的原始颜色" end,
        text_template = "<size=12><color=AAAAAA>%s</color></size>",
    },

    -- ============================================
    -- 施法条发光设置
    -- ============================================
    {
        type = "label",
        get = function() return "施法条发光设置" end,
        text_template = "<size=16><color=FFFF00>%s</color></size>",
    },

    {
        key = "enableCastbarGlowModule",
        type = "toggle",
        default = true,
        name = "被施法时发光提醒",
        desc = "当你是施法目标时，施法条会发光提醒",
    },

    -- ============================================
    -- 测试模式
    -- ============================================
    {
        type = "label",
        get = function() return "测试模式" end,
        text_template = "<size=16><color=FFFF00>%s</color></size>",
    },

    {
        key = "testFlag",
        type = "toggle",
        default = false,
        name = "启用测试模式",
        desc = "启用后可在非战斗状态下预览效果（完成配置后禁用）",
    },
}

return config
