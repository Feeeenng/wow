-- BlacklistPanel.lua
local BL = MeetingStone_Blacklist

BlacklistPanel = {}
local BP = BlacklistPanel

function BL:SetupPanel()
    local MS = LibStub('AceAddon-3.0'):GetAddon('MeetingStone')
    local GUI = LibStub('NetEaseGUI-2.0')
    local MainPanel = MS:GetModule('MainPanel')

    local panel = CreateFrame('Frame', nil, MainPanel)
    GUI:Embed(panel, 'Tab')
    MainPanel:RegisterPanel('黑名单', panel, {after = '屏蔽玩家列表'})

    local list = GUI:GetClass('DataGridView'):New(panel)
    do
        list:SetAllPoints(panel)
        list:SetItemHighlightWithoutChecked(true)
        list:SetItemHeight(32)
        list:SetItemSpacing(1)
        list:SetItemClass(MS:GetClass('BrowseItem'))
        list:SetSelectMode('RADIO')
        list:SetScrollStep(9)

        BP.checkboxes = {}

        list:InitHeader({
            {
                key = '@',
                text = '@',
                width = 30,
                enableMouse = true,
                class = MS:GetClass('CheckBox'),
                formatHandler = function(grid, entry)
                    grid:SetHeight(30)
                    grid.Check:SetSize(32, 32)
                    grid.Check:SetPoint('CENTER')
                    grid.Check:SetChecked(entry.selected)
                    grid:SetCallback('OnChanged', function(data)
                        if entry then
                            entry.selected = data.Check:GetChecked()
                            BP.checkboxes[data] = true
                        end
                    end)
                end,
            },
            {
                key = 'Name',
                text = '玩家名',
                style = 'LEFT',
                width = 200,
                showHandler = function(entry)
                    return entry.name, NORMAL_FONT_COLOR.r, NORMAL_FONT_COLOR.g, NORMAL_FONT_COLOR.b
                end,
            },
            {
                key = 'Time',
                text = '拉黑时间',
                width = 200,
                showHandler = function(entry)
                    return entry.time
                end,
            },
            {
                key = 'Reason',
                text = '理由',
                width = 350,
                showHandler = function(entry)
                    return entry.reason
                end,
            },
        })

        list:SetHeaderPoint('BOTTOMLEFT', list, 'TOPLEFT', -2, 2)
        list:SetItemList(MEETINGSTONE_BLACKLIST_DB)
    end
    BP.BlacklistList = list

    -- 手动添加 + 移除选中：并排居中，左添加右移除
    local manualAddBtn = CreateFrame('Button', nil, panel, 'UIPanelButtonTemplate')
    do
        manualAddBtn:SetSize(100, 22)
        manualAddBtn:SetPoint('BOTTOM', MainPanel, 'BOTTOM', -65, 4)
        manualAddBtn:SetText('手动添加')
        manualAddBtn:SetScript('OnClick', function()
            BL:PromptManualAdd()
        end)
    end

    local removeBtn = CreateFrame('Button', nil, panel, 'UIPanelButtonTemplate')
    do
        removeBtn:SetSize(120, 22)
        removeBtn:SetPoint('LEFT', manualAddBtn, 'RIGHT', 8, 0)
        removeBtn:SetText('移除选中玩家')
        removeBtn:SetScript('OnClick', function()
            for i = #MEETINGSTONE_BLACKLIST_DB, 1, -1 do
                local entry = MEETINGSTONE_BLACKLIST_DB[i]
                if entry.selected then
                    entry.selected = nil
                    BL:Remove(entry.name)
                end
            end
            for cb in pairs(BP.checkboxes) do
                cb.Check:SetChecked(false)
            end
            BP.checkboxes = {}
            BP.BlacklistList:Refresh()
        end)
    end

    -- 全选/取消全选（左下角）
    local selectAllBtn = CreateFrame('Button', nil, panel)
    do
        selectAllBtn:SetNormalFontObject('GameFontNormalSmall')
        selectAllBtn:SetHighlightFontObject('GameFontHighlightSmall')
        selectAllBtn:SetSize(70, 22)
        selectAllBtn:SetPoint('BOTTOMLEFT', MainPanel, 30, 3)
        selectAllBtn:SetText('全选/取消全选')
        selectAllBtn:RegisterForClicks('anyUp')
        selectAllBtn:SetScript('OnClick', function()
            for _, entry in ipairs(MEETINGSTONE_BLACKLIST_DB) do
                entry.selected = not entry.selected
            end
            BP.BlacklistList:Refresh()
        end)
    end
end
