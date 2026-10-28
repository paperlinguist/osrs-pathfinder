import registryJson from "@/data/quests.json";

export interface SkillReq {
  level: number;
  boostable: boolean;
  requiredToStart: boolean;
}

export interface Quest {
  key: string;
  name: string;
  registryName: string | null;
  enum: string;
  cacheId: number | null;
  difficulty: string;
  qp: number | null; // quest points REQUIRED to start (null = none)
  f2p: boolean;
  members: boolean;
  skills: Record<string, SkillReq>;
  quests: string[]; // prerequisite quest keys
  xp: Record<string, number>; // xp rewards per skill
  length: string | null;
  release: string | null;
  noReqData?: boolean;
}

const raw = registryJson as { meta: unknown; quests: Quest[] };
export const QUESTS: Quest[] = raw.quests;

export const QUEST_BY_KEY: Record<string, Quest> = Object.fromEntries(
  QUESTS.map((q) => [q.key, q]),
);

export const SKILL_NAMES = [
  "Attack", "Defence", "Strength", "Hitpoints", "Ranged", "Prayer", "Magic",
  "Cooking", "Woodcutting", "Fletching", "Fishing", "Firemaking", "Crafting",
  "Smithing", "Mining", "Herblore", "Agility", "Thieving", "Slayer", "Farming",
  "Runecraft", "Hunter", "Construction", "Sailing",
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

/** combat-oriented skills for combat level calc */
const COMBAT_SKILLS = ["Attack", "Strength", "Defence", "Hitpoints", "Ranged", "Prayer", "Magic"] as const;

export interface PlayerSkills {
  /** level per skill, e.g. { Attack: 76 } — missing skill = level 1 */
  levels: Record<string, number>;
  /** xp per skill (hiscores xp), optional */
  xp: Record<string, number>;
  username?: string;
  combatLevel?: number;
  source: "wiseoldman" | "hiscores" | "manual";
}

/** OSRS 1-99 XP table (cumulative XP at level start) */
const XP_TABLE: number[] = (() => {
  const t: number[] = [0, 0];
  let acc = 0;
  for (let lvl = 2; lvl <= 99; lvl++) {
    acc += Math.floor((lvl - 1) + 300 * Math.pow(2, (lvl - 1) / 7)) / 4;
    t[lvl] = Math.floor(acc);
  }
  return t;
})();

export function xpForLevel(level: number): number {
  if (level < 1) return 0;
  if (level > 99) return 13034431 + 1;
  return XP_TABLE[level];
}

export function levelForXp(xp: number): number {
  let lvl = 1;
  for (let i = 99; i >= 1; i--) {
    if (xp >= XP_TABLE[i]) { lvl = i; break; }
  }
  return lvl;
}

/** Standard OSRS combat level formula (floor) */
export function combatLevel(levels: Record<string, number>): number {
  const get = (s: string) => levels[s] ?? 1;
  const base = 0.25 * (get("Defence") + get("Hitpoints") + Math.floor(get("Prayer") / 2));
  const melee = 0.325 * (get("Attack") + get("Strength"));
  const ranged = 0.325 * (Math.floor(get("Ranged") * 1.5));
  const magic = 0.325 * (Math.floor(get("Magic") * 1.5));
  return Math.floor(base + Math.max(melee, ranged, magic));
}

export function computeCombat(player: PlayerSkills): number {
  if (player.combatLevel) return player.combatLevel;
  return combatLevel(player.levels);
}

const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Accept untrusted player JSON (localStorage saves, char slots, backup files)
 * and return a safe PlayerSkills, or null when unusable. Guarantees levels/xp
 * are real objects with numeric values — legacy saves from before the xp field
 * existed (or hand-edited saves) would otherwise crash every downstream render
 * on `player.xp[skill]` with xp undefined.
 */
export function normalizePlayer(raw: unknown): PlayerSkills | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!p.levels || typeof p.levels !== "object") return null;
  const levels: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.levels as Record<string, unknown>)) {
    const n = asNumber(v);
    if (n !== undefined) levels[k] = n;
  }
  const xp: Record<string, number> = {};
  if (p.xp && typeof p.xp === "object") {
    for (const [k, v] of Object.entries(p.xp as Record<string, unknown>)) {
      const n = asNumber(v);
      if (n !== undefined) xp[k] = n;
    }
  }
  return {
    levels,
    xp,
    username: typeof p.username === "string" && p.username ? p.username : undefined,
    combatLevel: asNumber(p.combatLevel),
    source:
      p.source === "wiseoldman" || p.source === "hiscores" || p.source === "manual"
        ? p.source
        : "manual",
  };
}

/** which skills a quest's requirement needs, including virtual "Combat" */
export function skillReqEntries(q: Quest): [string, SkillReq][] {
  return Object.entries(q.skills);
}

export function effectiveLevel(
  player: PlayerSkills,
  skill: string,
  bonusXp: number,
): number {
  if (skill === "Combat") return computeCombat(player);
  const base = player.levels?.[skill] ?? 1;
  const qxp = player.xp?.[skill] ?? 0;
  // effective level from current xp + quest-given xp, but never lower than base level
  const fromXp = levelForXp(qxp + bonusXp);
  return Math.max(base, fromXp);
}

export function formatXp(n: number): string {
  return n.toLocaleString("en-US");
}

/* ------------------------------------------------------ quest points model */

/**
 * Quest points awarded for completing a quest. The dataset records `qp` as the
 * points REQUIRED TO START (a gate like Dragon Slayer I's 32 QP), and has no
 * per-quest "awarded" field — so the app models awarded points as 1 for every
 * real quest and 0 for miniquests and activities (which award none in game).
 */
export function questPointsAwarded(q: Quest): number {
  return q.difficulty === "Miniquest" || q.difficulty === "Activity" ? 0 : 1;
}

/** Total quest points earned for a set of completed quest keys. */
export function totalQuestPoints(completed: Iterable<string>): number {
  let sum = 0;
  for (const key of completed) {
    const q = QUEST_BY_KEY[key];
    if (q) sum += questPointsAwarded(q);
  }
  return sum;
}

/* ------------------------------------------------- shared UI color tokens */

/** Badge color classes per difficulty — shared by the list rows and the graph nodes. */
export const DIFF_COLORS: Record<string, string> = {
  Novice: "bg-emerald-900/60 text-emerald-300 border-emerald-700/50",
  Intermediate: "bg-amber-900/50 text-amber-300 border-amber-700/50",
  Experienced: "bg-orange-900/50 text-orange-300 border-orange-700/50",
  Master: "bg-rose-900/50 text-rose-300 border-rose-700/50",
  Grandmaster: "bg-red-900/60 text-red-300 border-red-700/60",
  Special: "bg-purple-900/50 text-purple-300 border-purple-700/50",
  Miniquest: "bg-teal-900/50 text-teal-300 border-teal-700/50",
  Activity: "bg-stone-800 text-stone-300 border-stone-600",
  Unknown: "bg-stone-800 text-stone-300 border-stone-600",
};

/* -------------------------------------------------- quest cape pseudo-target */

/**
 * Synthetic "plan everything" target: the resolver treats it as every quest in
 * the dataset at once, ordered by the same topological greedy as a normal run.
 */
export const QUEST_CAPE_KEY = "__quest_cape__";

export const QUEST_CAPE_QUEST: Quest = {
  key: QUEST_CAPE_KEY,
  name: "Quest Cape",
  registryName: null,
  enum: "",
  cacheId: null,
  difficulty: "Special",
  qp: null,
  f2p: false,
  members: true,
  skills: {},
  quests: [],
  xp: {},
  length: null,
  release: null,
};

/** True for real quest keys and the synthetic Quest Cape target. */
export function isValidTargetKey(key: string): boolean {
  return key === QUEST_CAPE_KEY || !!QUEST_BY_KEY[key];
}

/* ------------------------------------------------------- time estimates */

/** Wiki quest-length buckets mapped to rough completion minutes. */
const LENGTH_MINUTES: Record<string, number> = {
  "Very Short": 5,
  Short: 12,
  Medium: 25,
  Long: 50,
  "Very Long": 100,
};

/** Estimated minutes to play through a quest, or null when the wiki has no length. */
export function questMinutes(q: Quest): number | null {
  return q.length ? (LENGTH_MINUTES[q.length] ?? null) : null;
}

/** Compact duration: "12m", "1h 30m". */
export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ------------------------------------------------- training time estimates */

/**
 * Rough XP-per-hour at typical mid-game methods, used only for "≈how long
 * would this grind take" hints. Deliberately conservative averages — real
 * rates swing wildly with method, boosts and attention level.
 */
export const XP_PER_HOUR: Record<string, number> = {
  Attack: 65000, Defence: 65000, Strength: 65000, Hitpoints: 90000,
  Ranged: 80000, Prayer: 350000, Magic: 80000,
  Cooking: 150000, Woodcutting: 60000, Fletching: 250000, Fishing: 45000,
  Firemaking: 250000, Crafting: 120000, Smithing: 100000, Mining: 55000,
  Herblore: 200000, Agility: 45000, Thieving: 180000, Slayer: 60000,
  Farming: 120000, Runecraft: 35000, Hunter: 90000, Construction: 500000,
  Sailing: 60000,
};

/**
 * Estimated hours of training for `xp` amounts of a skill's XP, or null when
 * the skill has no rate entry (virtual skills like Combat).
 */
export function trainHours(skill: string, xp: number): number | null {
  const rate = XP_PER_HOUR[skill];
  if (!rate || xp <= 0) return null;
  return xp / rate;
}

/** Human duration for hour estimates: "45m", "3h 20m", "12h+". */
export function formatHours(hours: number): string {
  const min = Math.round(hours * 60);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  if (min < 12 * 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(hours)}h+`;
}
