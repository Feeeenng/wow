-- ============================================================
-- Plater 打断优先级染色 — Hook 脚本
-- 将各段代码粘贴到 Plater 脚本编辑器对应 Hook 中
-- ============================================================


-- ============================================================
-- Hook 1: Initialization  （粘贴到 Initialization）
-- 数据表和颜色在这里维护，修改后重新粘贴并 /reload
-- 获取NPC ID：目标怪物后执行 /run print(select(6, strsplit("-", UnitGUID("target"))))
-- ============================================================
--[[

_IC = {
    list = {
        -- ===== 副本名 =====
        -- [NPC_ID] = 1,  -- 怪物名
        -- [NPC_ID] = 2,  -- 怪物名
        -- [NPC_ID] = 3,  -- 怪物名
    },
    colors = {
        [1] = {0,   1,   0  },  -- 绿色：1人打断
        [2] = {1,   0.5, 0  },  -- 橙色：2人打断
        [3] = {0.2, 0.6, 1  },  -- 蓝色：3人打断
    },
}

]]


-- ============================================================
-- Hook 2: On Show  （粘贴到 On Show）
-- ============================================================
--[[

if not _IC then return end
local guid = UnitGUID(unitId)
if not guid then return end
local npcID = tonumber(select(6, strsplit("-", guid)))
if not npcID then return end
local count = _IC.list[npcID]
if not count then return end
local c = _IC.colors[count]
if c then unitFrame.healthBar:SetStatusBarColor(c[1], c[2], c[3]) end

]]


-- ============================================================
-- Hook 3: On Update  （粘贴到 On Update）
-- ============================================================
--[[

if not _IC then return end
local guid = UnitGUID(unitId)
if not guid then return end
local npcID = tonumber(select(6, strsplit("-", guid)))
if not npcID then return end
local count = _IC.list[npcID]
if not count then return end
local c = _IC.colors[count]
if c then unitFrame.healthBar:SetStatusBarColor(c[1], c[2], c[3]) end

]]
