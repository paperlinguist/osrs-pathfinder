import bossesJson from "@/data/bosses.json";
import gearJson from "@/data/gear.json";
import { ownedKey } from "./character-export";
import { QUEST_BY_KEY } from "./quest-data";

/* -------------------------------------------------------------- boss types */

export interface BossSkillReq {
  skill: string;
  level: number;
  note: string;
}

export interface BossRequirements {
  quests: string[]; // quest keys (see src/data/quests.json)
  skills: BossSkillReq[]; // hard requirements
}

export interface BossInvItem {
  name: string;
  qty: string;
  note: string;
}

/** preset slot keys in canonical display order */
export const SLOT_KEYS = [
  "head", "cape", "neck", "ammo", "weapon", "shield", "body", "hands", "legs", "feet", "ring",
] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export const SLOT_LABELS: Record<SlotKey, string> = {
  head: "Head", cape: "Cape", neck: "Neck", ammo: "Ammo", weapon: "Weapon", shield: "Off-hand",
  body: "Body", hands: "Hands", legs: "Legs", feet: "Feet", ring: "Ring",
};

export interface BossPreset {
  name: string;
  description: string;
  slots: Partial<Record<SlotKey, string>>; // item names → resolved via gear.json
  inventory: BossInvItem[];
  notes: string;
}

export type BossStyle = "Melee" | "Ranged" | "Magic";

export interface Boss {
  key: string;
  name: string;
  tier: string;
  tagline: string;
  members: boolean;
  wiki: string;
  location: string;
  duration: string;
  requirements: BossRequirements;
  recommended: BossSkillReq[]; // advisory levels
  styles: string[];
  presets: BossPreset[];
  notes: string;
}

/* -------------------------------------------------------------- gear types */

export interface GearStats {
  stabAttack: number; slashAttack: number; crushAttack: number; magicAttack: number;
  rangedAttack: number; stabDefence: number; slashDefence: number; crushDefence: number;
  magicDefence: number; rangedDefence: number; strengthBonus: number; rangedStrength: number;
  magicDamage: number; prayerBonus: number;
}

export interface GearItem {
  id: number;
  name: string;
  rawName: string;
  slot: string; // osrs-db slot label ("Weapon", "Two-handed", …)
  members: boolean;
  stats: GearStats;
  speed: number;
  reqLevels: Record<string, number>;
  reqQuests: string[];
  override: string | null;
  price: number | null; // GE coins at snapshot; null = untradeable
}

/* ----------------------------------------------------------------- loaders */

const rawBosses = bossesJson as { meta: unknown; bosses: Boss[] };
export const BOSSES: Boss[] = rawBosses.bosses;
export const BOSS_BY_KEY: Record<string, Boss> = Object.fromEntries(BOSSES.map((b) => [b.key, b]));

const rawGear = gearJson as unknown as { meta: unknown; items: GearItem[] };
export const GEAR: GearItem[] = rawGear.items;
export const GEAR_BY_NAME: Map<string, GearItem> = new Map(GEAR.map((g) => [ownedKey(g.name), g]));

export function gearFor(name: string): GearItem | null {
  return GEAR_BY_NAME.get(ownedKey(name)) ?? null;
}

/** the gear.json item's OSRS slot → our preset slot key */
export function itemSlotKey(item: GearItem): SlotKey | null {
  switch (item.slot) {
    case "Head": return "head";
    case "Cape": return "cape";
    case "Neck": return "neck";
    case "Ammunition": return "ammo";
    case "Weapon":
    case "Two-handed": return "weapon";
    case "Shield": return "shield";
    case "Body": return "body";
    case "Hands": return "hands";
    case "Legs": return "legs";
    case "Feet": return "feet";
    case "Ring": return "ring";
    default: return null;
  }
}

/* ------------------------------------------------------------------ colors */

/** badge classes per boss tier — mirrors DIFF_COLORS in quest-data */
export const TIER_COLORS: Record<string, string> = {
  Introductory: "bg-emerald-900/60 text-emerald-300 border-emerald-700/50",
  Easy: "bg-teal-900/50 text-teal-300 border-teal-700/50",
  Medium: "bg-amber-900/50 text-amber-300 border-amber-700/50",
  Hard: "bg-rose-900/50 text-rose-300 border-rose-700/50",
  Unknown: "bg-stone-800 text-stone-300 border-stone-600",
};

/* ------------------------------------------------------------ stat display */

/** the 2–3 stat chips worth showing for an item under a combat style */
export function statChips(item: GearItem, style: string): { label: string; value: number }[] {
  const s = item.stats;
  const chips: { label: string; value: number }[] = [];
  if (style === "Ranged") {
    if (s.rangedAttack) chips.push({ label: "Rng atk", value: s.rangedAttack });
    if (s.rangedStrength) chips.push({ label: "Rng str", value: s.rangedStrength });
  } else if (style === "Magic") {
    if (s.magicAttack) chips.push({ label: "Mag atk", value: s.magicAttack });
    if (s.magicDamage) chips.push({ label: "Mag dmg", value: s.magicDamage });
  } else {
    const bestAtk = Math.max(s.stabAttack, s.slashAttack, s.crushAttack);
    if (bestAtk) chips.push({ label: "Atk", value: bestAtk });
    if (s.strengthBonus) chips.push({ label: "Str", value: s.strengthBonus });
  }
  if (s.prayerBonus) chips.push({ label: "Pray", value: s.prayerBonus });
  const bestDef = Math.max(s.stabDefence, s.slashDefence, s.crushDefence, s.magicDefence, s.rangedDefence);
  if (bestDef > 0) chips.push({ label: "Def", value: bestDef });
  return chips;
}

/** "9,146 gp" / "14.3m gp" */
export function formatPrice(gp: number): string {
  if (gp >= 1_000_000) return `${(gp / 1_000_000).toFixed(gp >= 10_000_000 ? 0 : 1)}m gp`;
  if (gp >= 10_000) return `${Math.round(gp / 1_000)}k gp`;
  return `${gp.toLocaleString("en-US")} gp`;
}

/** quest display name for a requirement key ("underground pass" → "Underground Pass") */
export function questName(key: string): string {
  return QUEST_BY_KEY[key]?.name ?? key;
}
