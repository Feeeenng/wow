import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface SpellMetadata {
  spellId: number;
  name: string;
  iconUrl: string | null;
  source: string;
}

export interface SpellTooltip {
  spellId: number;
  name: string;
  englishName?: string;
  description: string;
  rangeText?: string;
  castTimeText?: string;
  costText?: string;
  cooldownText?: string;
  descriptionNote?: string;
  dynamicValues?: boolean;
  source?: string;
  build?: string;
}

/** 客户端通过Rust读取资料和图片，不拼接第三方图标地址。 */
export const spellMetadataService = {
  async tooltips(spellIds: number[]): Promise<SpellTooltip[]> {
    if (!("__TAURI_INTERNALS__" in window)) return [];
    return invoke("get_spell_tooltips", { spellIds });
  },
  async get(spellIds: number[]): Promise<SpellMetadata[]> {
    if (!("__TAURI_INTERNALS__" in window)) return [];
    return invoke("get_spell_metadata", { spellIds });
  },
  async import(): Promise<number | null> {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "技能资料 JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return null;
    return invoke("import_spell_metadata", { path });
  },
};
