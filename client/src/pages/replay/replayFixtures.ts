import type { ReplayFixture } from "@/pages/replay/model";

/** 仅用于回放页面 UI 原型，不代表后端、CombatLog、WCL 或 Wowhead 返回数据。 */
export const replayFixtures: ReplayFixture[] = [
  {
    id: "demo-smolderon-heroic-03",
    instance: "阿梅达希尔，梦境之愿",
    boss: "火光之龙菲莱克",
    difficulty: "英雄",
    pullLabel: "第 3 次尝试",
    date: "2026-08-01 21:32:18",
    durationSeconds: 525,
    initialTime: 154,
    members: [
      {
        id: "member-tank",
        name: "铁壁之心",
        specialization: "防护战士",
        role: "tank",
        avatar: "/assets/record-1.png",
        status: "ready",
      },
      {
        id: "member-healer",
        name: "晨曦微光",
        specialization: "神圣骑士",
        role: "healer",
        avatar: "/assets/record-2.png",
        status: "ready",
      },
      {
        id: "member-melee",
        name: "逐风之刃",
        specialization: "狂徒潜行者",
        role: "melee",
        avatar: "/assets/record-3.png",
        status: "ready",
      },
      {
        id: "member-ranged",
        name: "星界旅人",
        specialization: "奥术法师",
        role: "ranged",
        avatar: "/assets/record-4.png",
        status: "processing",
      },
    ],
    tracks: [
      {
        kind: "damage",
        label: "伤害技能",
        events: [
          { id: "damage-1", time: 42, label: "爆发窗口", shortLabel: "爆" },
          { id: "damage-2", time: 154, label: "易伤爆发", shortLabel: "伤" },
          { id: "damage-3", time: 312, label: "斩杀阶段", shortLabel: "斩" },
          { id: "damage-4", time: 468, label: "终场爆发", shortLabel: "爆" },
        ],
      },
      {
        kind: "healing",
        label: "治疗技能",
        events: [
          { id: "healing-1", time: 76, label: "群体抬血", shortLabel: "疗" },
          { id: "healing-2", time: 206, label: "单体急救", shortLabel: "救" },
          { id: "healing-3", time: 392, label: "群体抬血", shortLabel: "疗" },
        ],
      },
      {
        kind: "buff",
        label: "增益",
        events: [
          { id: "buff-1", time: 28, label: "嗜血效果", shortLabel: "增" },
          { id: "buff-2", time: 238, label: "灌注效果", shortLabel: "增" },
          { id: "buff-3", time: 432, label: "药水效果", shortLabel: "增" },
        ],
      },
      {
        kind: "debuff",
        label: "减益",
        events: [
          { id: "debuff-1", time: 96, label: "烈焰印记", shortLabel: "减" },
          { id: "debuff-2", time: 286, label: "灼烧层数", shortLabel: "减" },
          { id: "debuff-3", time: 446, label: "烈焰印记", shortLabel: "减" },
        ],
      },
      {
        kind: "raid-cooldown",
        label: "团队大招",
        events: [
          { id: "cooldown-1", time: 128, label: "团队减伤", shortLabel: "盾" },
          { id: "cooldown-2", time: 342, label: "团队治疗", shortLabel: "团" },
        ],
      },
      {
        kind: "boss",
        label: "Boss 技能",
        events: [
          { id: "boss-1", time: 58, label: "烈焰风暴", shortLabel: "焰" },
          { id: "boss-2", time: 154, label: "毁灭咆哮", shortLabel: "吼" },
          { id: "boss-3", time: 264, label: "末日之种", shortLabel: "种" },
          { id: "boss-4", time: 398, label: "烈焰风暴", shortLabel: "焰" },
          { id: "boss-5", time: 502, label: "毁灭咆哮", shortLabel: "吼" },
        ],
      },
    ],
  },
];
