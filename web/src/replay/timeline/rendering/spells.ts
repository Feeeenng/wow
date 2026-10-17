import pack from "@/spell-pack";

const files = import.meta.glob<string>("@/spell-icons/*.jpg", { eager: true, query: "?url", import: "default" });
const icons = new Map(Object.entries(files).map(([name, url]) => [name.split("/").at(-1)!, url]));
const spells = new Map(pack.spells.map((spell) => [spell.spellId, { name: spell.name, icon: icons.get(spell.icon) }]));

/** 图标取自已有验证离线资料，未知技能保持缺图，不拼接第三方地址。 */
export const spellIcon = (id: number) => spells.get(id)?.icon;
