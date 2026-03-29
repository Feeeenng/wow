-- ============================================================
-- Plater 打断优先级染色 — Hook 脚本
-- 使用方法：将下面各 Hook 的代码分别粘贴到 Plater 对应 Hook 编辑器中
-- ============================================================


-- ============================================================
-- Hook 1: On Show  （粘贴到 Plater → Scripts → On Show）
-- ============================================================
--[[

-- 数据表和颜色在这里维护，修改后重新粘贴即可
-- 格式：[NPC_ID] = 需要几人打断 (1 / 2 / 3)
-- 获取NPC ID方法：目标怪物后执行 /run print(select(6, strsplit("-", UnitGUID("target"))))
if not _IC then
    _IC = {
        list = {
            -- ===== 示例（替换为实际NPC ID）=====
            -- [12345] = 1,  -- 怪物名（副本名）
            -- [67890] = 2,
            -- [11111] = 3,
        },
        -- 颜色配置 {r, g, b}
        colors = {
            [1] = {0,    1,   0  },  -- 绿色：1人打断
            [2] = {1,    0.5, 0  },  -- 橙色：2人打断
            [3] = {0.2,  0.6, 1  },  -- 蓝色：3人打断
        },
    }
end

local guid = UnitGUID(unitframe.unit)
if not guid then return end
local npcID = tonumber(select(6, strsplit("-", guid)))
if not npcID then return end

local count = _IC.list[npcID]
if not count then return end

local c = _IC.colors[count]
if not c then return end

unitframe.healthBar:SetStatusBarColor(c[1], c[2], c[3])

]]


-- ============================================================
-- Hook 2: On Health Update  （粘贴到 Plater → Scripts → On Health Update）
-- ============================================================
--[[

if not _IC then return end

local guid = UnitGUID(unitframe.unit)
if not guid then return end
local npcID = tonumber(select(6, strsplit("-", guid)))
if not npcID then return end

local count = _IC.list[npcID]
if not count then return end

local c = _IC.colors[count]
if not c then return end

unitframe.healthBar:SetStatusBarColor(c[1], c[2], c[3])

]]
