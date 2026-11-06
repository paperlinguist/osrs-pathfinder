import type { OwnedEntry } from "./character-export";
import { ownedKey } from "./character-export";
import type { PlayerSkills } from "./quest-data";
import type { Boss, BossPreset, BossSkillReq, GearItem, SlotKey } from "./boss-data";
import { gearFor } from "./boss-data";

/**
 * Boss readiness engine — the boss-planner counterpart of the quest resolver.
 *
 * Evaluates a boss's hard gates (required skills, required quests) against the
 * imported character, its recommended levels as advisory gaps, and every
 * preset item against equip requirements / quest gates / owned-items / budget.
 * All inputs are optional: with no character imported you still get the full
 * guide, just without personal verdicts.
 */

export interface BossSkillGap {
  skill: string;
  required: number;
  current: number | null; // null = no character imported
  met: boolean;
  kind: "required" | "recommended";
  note: string;
}

export interface BossQuestGate {
  key: string;
  done: boolean | null; // null = no completion data
}

export type LockReason =
  | { type: "level"; skill: string; required: number; current: number | null }
  | { type: "quest"; key: string };

export interface ItemCheck {
  slotKey: SlotKey;
  /** preset-referenced item name (display) */
  name: string;
  item: GearItem | null; // null = missing from gear.json (build should have caught it)
  owned: boolean | null; // null = no owned-items import
  ownedFrom: OwnedEntry["sources"] | null;
  locks: LockReason[];
  /** GE price at snapshot (null = untradeable) */
  price: number | null;
  /** not owned, no locks, buyable on the GE */
  buyable: boolean;
  /** buyable AND affordable against imported coins (null when either unknown) */
  affordable: boolean | null;
}

export interface PresetCheck {
  preset: BossPreset;
  style: string;
  items: ItemCheck[];
  ownedCount: number; // items you already have (when owned import present)
  knownOwned: boolean; // whether owned data exists at all
  /** total GE cost of missing+buyable items (null until every price known-ish) */
  missingCost: number | null;
  affordableCount: number;
  overBudgetCount: number;
}

export interface BossVerdict {
  status: "ready" | "gated" | "unknown"; // unknown = no character/quest data imported
  blockers: string[]; // human summary of what gates the boss
  skillGaps: BossSkillGap[]; // unmet required skills
  questGates: BossQuestGate[]; // required quests
  recGaps: BossSkillGap[]; // unmet recommended levels
  recMet: BossSkillGap[];
  presets: PresetCheck[];
}

export interface ReadinessInput {
  player: PlayerSkills | null;
  completed: Set<string> | null; // null = no completion data
  ownedIndex: Map<string, OwnedEntry> | null; // null = no bank/equipment import
  coins: number | null;
}

function skillGap(
  req: BossSkillReq,
  player: PlayerSkills | null,
  kind: "required" | "recommended",
): BossSkillGap {
  const current = player ? (player.levels[req.skill] ?? 1) : null;
  return {
    skill: req.skill,
    required: req.level,
    current,
    met: current === null ? false : current >= req.level,
    kind,
    note: req.note,
  };
}

/** equip/quest gates for one item against the imported character (shared by
 *  the preset checks and the upgrade advisor) */
export function computeItemLocks(
  item: GearItem,
  player: PlayerSkills | null,
  completed: Set<string> | null,
): LockReason[] {
  const locks: LockReason[] = [];
  for (const [skill, required] of Object.entries(item.reqLevels)) {
    const current = player ? (player.levels[skill] ?? 1) : null;
    if (current === null || current < required) {
      locks.push({ type: "level", skill, required, current });
    }
  }
  for (const q of item.reqQuests) {
    if (completed === null || !completed.has(q)) {
      locks.push({ type: "quest", key: q });
    }
  }
  return locks;
}

function checkItem(
  slotKey: SlotKey,
  name: string,
  input: ReadinessInput,
): ItemCheck {
  const item = gearFor(name);
  const locks = item ? computeItemLocks(item, input.player, input.completed) : [];
  const owned = input.ownedIndex ? (input.ownedIndex.get(ownedKey(name)) !== undefined) : null;
  const ownedFrom = owned && input.ownedIndex ? input.ownedIndex.get(ownedKey(name))?.sources ?? null : null;
  const price = item?.price ?? null;
  const buyable = owned === false && price !== null && locks.length === 0;
  const affordable = buyable && input.coins !== null ? price <= input.coins! : null;
  return { slotKey, name, item, owned, ownedFrom, locks, price, buyable, affordable };
}

function checkPreset(boss: Boss, preset: BossPreset, input: ReadinessInput): PresetCheck {
  const style = boss.styles[0] ?? "Melee";
  const items: ItemCheck[] = [];
  for (const [slotKey, name] of Object.entries(preset.slots) as [SlotKey, string][]) {
    items.push(checkItem(slotKey, name, input));
  }
  const knownOwned = input.ownedIndex !== null;
  const ownedCount = items.filter((i) => i.owned === true).length;
  const missingBuyable = items.filter((i) => i.buyable);
  // GE cost of everything missing that you could actually buy (owned data
  // present); locked/untradeable items aren't purchasable and are excluded
  const missingCost = knownOwned
    ? missingBuyable.reduce((a, i) => a + (i.price ?? 0), 0)
    : null;
  const affordableCount = missingBuyable.filter((i) => i.affordable === true).length;
  const overBudgetCount = missingBuyable.filter((i) => i.affordable === false).length;
  return { preset, style, items, ownedCount, knownOwned, missingCost, affordableCount, overBudgetCount };
}

export function evaluateBoss(boss: Boss, input: ReadinessInput): BossVerdict {
  const skillGaps = boss.requirements.skills.map((r) => skillGap(r, input.player, "required"));
  const recs = boss.recommended.map((r) => skillGap(r, input.player, "recommended"));
  const questGates: BossQuestGate[] = boss.requirements.quests.map((key) => ({
    key,
    done: input.completed === null ? null : input.completed.has(key),
  }));

  const blockers: string[] = [];
  if (input.player === null && input.completed === null) {
    // no data at all → guide-only mode
  } else {
    for (const g of skillGaps) {
      if (!g.met) blockers.push(`${g.skill} ${g.current ?? "?"} → ${g.required}`);
    }
    for (const q of questGates) {
      if (q.done === false) blockers.push(`quest: ${q.key}`);
    }
  }

  const status: BossVerdict["status"] =
    input.player === null && input.completed === null
      ? "unknown"
      : blockers.length === 0
        ? "ready"
        : "gated";

  return {
    status,
    blockers,
    skillGaps,
    questGates,
    recGaps: recs.filter((r) => !r.met),
    recMet: recs.filter((r) => r.met),
    presets: boss.presets.map((p) => checkPreset(boss, p, input)),
  };
}
