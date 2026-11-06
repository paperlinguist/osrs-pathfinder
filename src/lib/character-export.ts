import { combatLevel, type PlayerSkills } from "./quest-data";
import { parseQuestStateExport, type ParsedQuestState } from "./quest-state-import";

/**
 * Parsers for the JSON files written by the RuneLite "Character Export"
 * plugin (https://runelite.net/plugin-hub/show/character-export).
 *
 * Files live under `.runelite/character-exporter/<Account>/`:
 *   character.json  — skills (real/boosted level + xp), account name, world
 *   bank.json       — { kind:"bank", items:[{slot,id,quantity,name}] }
 *   equipment.json  — { kind:"equipment", ... } (currently worn items)
 *   inventory.json  — { kind:"inventory", ... } (carried items)
 *
 * Everything is parsed in the browser — no file contents ever leave the
 * visitor's machine (same privacy model as the quest-state import).
 */

/** one item row as written by the plugin (ids already canonicalized by RuneLite) */
export interface ExportedItem {
  id: number;
  quantity: number;
  name: string;
}

export interface OwnedItems {
  bank: ExportedItem[];
  equipment: ExportedItem[];
  inventory: ExportedItem[];
  /** total Coins (item id 995) across imported containers, null when none imported */
  coins: number | null;
  accountName: string | null;
  updatedAt: string | null;
}

export const EMPTY_OWNED: OwnedItems = {
  bank: [], equipment: [], inventory: [], coins: null, accountName: null, updatedAt: null,
};

/* ------------------------------------------------------------- skills file */

/** stat key (RuneLite skill name) → canonical skill name */
const STAT_KEY_MAP: Record<string, string> = {
  attack: "Attack", defence: "Defence", strength: "Strength", hitpoints: "Hitpoints",
  ranged: "Ranged", prayer: "Prayer", magic: "Magic", cooking: "Cooking",
  woodcutting: "Woodcutting", fletching: "Fletching", fishing: "Fishing",
  firemaking: "Firemaking", crafting: "Crafting", smithing: "Smithing",
  mining: "Mining", herblore: "Herblore", agility: "Agility", thieving: "Thieving",
  slayer: "Slayer", farming: "Farming", runecraft: "Runecraft", runecrafting: "Runecraft",
  hunter: "Hunter", construction: "Construction", sailing: "Sailing",
};

/**
 * Parse a character.json payload into a PlayerSkills (real levels + xp).
 * Returns null when the payload doesn't look like a character export.
 */
export function parseCharacterFile(raw: unknown): PlayerSkills | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const stats = obj.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;

  const levels: Record<string, number> = {};
  const xp: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
    const skill = STAT_KEY_MAP[k.toLowerCase()] ?? STAT_KEY_MAP[k] ?? k;
    if (!v || typeof v !== "object") continue;
    const s = v as Record<string, unknown>;
    const lvl = typeof s.real_level === "number" ? s.real_level : NaN;
    if (!Number.isFinite(lvl)) continue;
    levels[skill] = lvl;
    xp[skill] = typeof s.experience === "number" ? s.experience : 0;
  }
  if (Object.keys(levels).length === 0) return null;

  return {
    levels,
    xp,
    username: typeof obj.account_name === "string" && obj.account_name.trim()
      ? obj.account_name.trim()
      : undefined,
    combatLevel: combatLevel(levels),
    source: "character-export",
  };
}

/* -------------------------------------------------- container files (items) */

export interface ParsedContainer {
  kind: "bank" | "equipment" | "inventory";
  items: ExportedItem[];
}

/**
 * Parse a bank.json / equipment.json / inventory.json payload.
 * Returns null when the payload isn't a Character Export container.
 */
export function parseContainerFile(raw: unknown): ParsedContainer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (kind !== "bank" && kind !== "equipment" && kind !== "inventory") return null;
  if (!Array.isArray(obj.items)) return null;

  const items: ExportedItem[] = [];
  for (const it of obj.items) {
    if (!it || typeof it !== "object") continue;
    const e = it as Record<string, unknown>;
    if (typeof e.id !== "number" || typeof e.quantity !== "number") continue;
    if (typeof e.name !== "string" || !e.name) continue;
    items.push({ id: e.id, quantity: e.quantity, name: e.name });
  }
  return { kind, items };
}

/* -------------------------------------------------------- owned-item index */

/**
 * Normalized matching key for an item name, so gear data (osrs-db style
 * "Amulet of glory#4") and plugin exports ("Amulet of glory(6)") agree:
 * lowercase, drop the "#variant" suffix and "(count)" charge suffixes.
 */
export function ownedKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/#.*$/, "")
    .replace(/\(\d+\)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface OwnedEntry {
  quantity: number;
  sources: ("bank" | "equipment" | "inventory")[];
}

/** merged owned-items index across all imported containers */
export function buildOwnedIndex(owned: OwnedItems): Map<string, OwnedEntry> {
  const idx = new Map<string, OwnedEntry>();
  for (const src of ["bank", "equipment", "inventory"] as const) {
    for (const it of owned[src]) {
      const key = ownedKey(it.name);
      if (!key) continue;
      const cur = idx.get(key);
      if (cur) {
        cur.quantity += it.quantity;
        if (!cur.sources.includes(src)) cur.sources.push(src);
      } else {
        idx.set(key, { quantity: it.quantity, sources: [src] });
      }
    }
  }
  return idx;
}

/** merge freshly parsed containers (and their coin total) into an OwnedItems */
export function mergeOwned(existing: OwnedItems, updates: ParsedContainer[]): OwnedItems {
  const next: OwnedItems = {
    bank: existing.bank, equipment: existing.equipment, inventory: existing.inventory,
    coins: existing.coins, accountName: existing.accountName, updatedAt: existing.updatedAt,
  };
  for (const c of updates) next[c.kind] = c.items;
  next.coins = totalCoins(next);
  next.updatedAt = new Date().toISOString();
  return next;
}

/** sum Coins (id 995) across containers; null when nothing imported */
export function totalCoins(owned: OwnedItems): number | null {
  const lists = [owned.bank, owned.equipment, owned.inventory];
  if (lists.every((l) => l.length === 0)) return null;
  return lists.reduce(
    (sum, list) => sum + list.reduce((a, it) => (it.id === 995 ? a + it.quantity : a), 0),
    0,
  );
}

/** safe-parse an OwnedItems from localStorage saves */
export function normalizeOwned(raw: unknown): OwnedItems {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_OWNED };
  const o = raw as Record<string, unknown>;
  const items = (v: unknown): ExportedItem[] =>
    Array.isArray(v)
      ? v.filter(
          (it): it is ExportedItem =>
            !!it && typeof it === "object" &&
            typeof (it as ExportedItem).id === "number" &&
            typeof (it as ExportedItem).quantity === "number" &&
            typeof (it as ExportedItem).name === "string",
        )
      : [];
  const bank = items(o.bank);
  const equipment = items(o.equipment);
  const inventory = items(o.inventory);
  return {
    bank, equipment, inventory,
    coins: typeof o.coins === "number" ? o.coins : totalCoins({ ...EMPTY_OWNED, bank, equipment, inventory }),
    accountName: typeof o.accountName === "string" ? o.accountName : null,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
  };
}

/* -------------------------------------------------- one-picker file reading */

export interface CharacterExportReadout {
  /** character.json → skills */
  player: PlayerSkills | null;
  /** quests.json (Character Export) or any Quest State Exporter file → quest states */
  questState: ParsedQuestState | null;
  /** bank / equipment / inventory.json */
  containers: ParsedContainer[];
  /** file names nothing could parse */
  unrecognized: string[];
}

/**
 * Read a mixed bag of user-picked files and route each by shape:
 * skills file, quest-state file, or item container. One picker, any
 * combination — pages apply the pieces they care about.
 */
export async function readCharacterExportFiles(files: File[]): Promise<CharacterExportReadout> {
  const out: CharacterExportReadout = {
    player: null, questState: null, containers: [], unrecognized: [],
  };
  for (const f of files) {
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch {
      out.unrecognized.push(f.name);
      continue;
    }
    const player = parseCharacterFile(json);
    if (player) {
      out.player = player;
      continue;
    }
    const container = parseContainerFile(json);
    if (container) {
      out.containers.push(container);
      continue;
    }
    const questState = parseQuestStateExport(json);
    if (questState) {
      out.questState = questState;
      continue;
    }
    out.unrecognized.push(f.name);
  }
  return out;
}
