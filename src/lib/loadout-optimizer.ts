import {
  GEAR,
  SLOT_KEYS,
  defScore,
  gearFor,
  itemSlotKey,
  presetStyle,
  styleScore,
  type Boss,
  type BossPreset,
  type GearItem,
  type SlotKey,
} from "./boss-data";
import { ownedKey, type OwnedEntry } from "./character-export";
import type { PlayerSkills } from "./quest-data";
import { computeItemLocks, type LockReason } from "./boss-readiness";

/**
 * Per-preset comfort optimizer — "the budget tier gets me through, but I own
 * (or can easily buy) better; what should I actually wear?"
 *
 * For every slot of a preset it ranks the pool's items that beat the preset
 * pick (see `beats`) and walks that ranking taking the first item you own or
 * can afford — purchases share the coin pile greedily, biggest gains first,
 * so a mid-tier purchase (dragon crossbow) lands when the best (armadyl) is
 * out of reach. Slots that stay put get a near-miss line explaining what the
 * closest better option is and what's holding it back (equip/quest locks,
 * budget, untradeable).
 *
 * Scoring is the same deliberately-transparent styleScore as the upgrade
 * advisor (attack + damage bonus; attack speed ignored — no DPS formula is
 * pretended). Rules keep suggestions honest where the score can't see:
 *
 *  - mechanic gear is untouchable (UTILITY_ITEMS, the obsidian set, below):
 *    items chosen for a fight mechanic or set bonus are never swapped out
 *    nor suggested into other loadouts;
 *  - shapes must fit: two-handed weapons never displace a filled off-hand,
 *    a weapon upgrade must fire the ammo the preset already uses, and ammo
 *    must match the weapon's family *and tier* (dragon bolts only fire from
 *    dragon-tier crossbows — wiki-verified);
 *  - armour (head/body/legs/feet/shield) that ties on offence but tanks
 *    better counts as a comfort upgrade — Karil's over black d'hide would
 *    otherwise be invisible to the score.
 */

export interface SlotUpgrade {
  slotKey: SlotKey;
  fromName: string;
  fromScore: number;
  toItem: GearItem;
  toScore: number;
  /** style-score delta (0 for defence-tie upgrades — see defGain) */
  gain: number;
  /** defence-score delta — set when the upgrade is a tank-slot tie-break */
  defGain: number;
  source: "owned" | "buy";
  /** buy price; null for owned upgrades (they're free) */
  price: number | null;
}

export type NearMissReason = "locked" | "over-budget" | "untradeable";

/** why a better option didn't make the list — shown per empty slot */
export interface SlotNearMiss {
  slotKey: SlotKey;
  item: GearItem;
  gain: number;
  defGain: number;
  price: number | null;
  locks: LockReason[];
  reason: NearMissReason;
  /** you already own it — it's locked by levels/quests, not money */
  owned: boolean;
}

export interface LoadoutOptimization {
  style: string;
  /** SLOT_KEYS display order */
  upgrades: SlotUpgrade[];
  nearMisses: SlotNearMiss[];
  buyCount: number;
  /** total gp of the buy upgrades */
  totalCost: number;
  /** purchases fit the imported coin pile (null = no coins imported) */
  withinBudget: boolean | null;
}

export interface OptimizerInput {
  player: PlayerSkills | null;
  completed: Set<string> | null;
  /** null = no bank/equipment import → nothing to personalise against */
  ownedIndex: Map<string, OwnedEntry> | null;
  coins: number | null;
}

/**
 * Items whose preset value a style score can't measure — never replaced,
 * never suggested. Extend only for gear a *mechanic* demands (a dragonfire
 * shield at Vorkath is survivability, not stats), never for situational
 * preferences; the preset notes explain the mechanic.
 */
const UTILITY_ITEMS = new Set(
  [
    "anti-dragon shield", // dragonfire protection (Vorkath magic, budget)
    "dragonfire shield", // dragonfire protection (KBD, Vorkath ranged)
    "spectral spirit shield", // prayer sustain vs Cerberus ghosts
    "zamorakian spear", // Corp halves non-spear damage
    "bone mace", // Scurrius bone-weapon damage bonus
    "dragon hunter crossbow", // dragon-only damage bonus (score-blind)
    "dragon hunter lance", // dragon-only damage bonus (score-blind)
    "berserker necklace", // +20% obsidian-weapon damage synergy
    "ring of dueling", // teleport utility, no combat stats
  ].map(ownedKey),
);

/**
 * The obsidian set works as a unit: full armour gives obsidian weapons +10%
 * melee damage and accuracy, stacking with the berserker necklace's +20%
 * (wiki-verified). When the preset wields an obsidian weapon the weapon and
 * armour pieces stay locked together — a whip swap looks like +68 to the
 * score but silently kills both multipliers.
 */
const OBSIDIAN_WEAPONS = new Set(
  ["Toktz-xil-ak", "Tzhaar-ket-om", "Toktz-xil-ek", "Tzhaar-ket-em"].map(ownedKey),
);
const OBSIDIAN_ARMOUR = new Set(
  ["Obsidian helmet", "Obsidian platebody", "Obsidian platelegs"].map(ownedKey),
);

/** crossbows that can fire dragon bolts (wiki: dragon bolts only fire from
 *  these — notably NOT the rune crossbow) */
const DRAGON_BOLT_CROSSBOWS = new Set(
  ["Dragon crossbow", "Armadyl crossbow", "Dragon hunter crossbow", "Zaryte crossbow"].map(ownedKey),
);

/** slots where "same offence, better defence" counts as a comfort upgrade */
const TANK_SLOTS = new Set<SlotKey>(["head", "body", "legs", "feet", "shield"]);

type AmmoFamily = "bolts" | "arrows" | "darts";

function ammoFamily(name: string): AmmoFamily | null {
  const k = ownedKey(name);
  if (k.includes("bolt")) return "bolts";
  if (k.includes("arrow")) return "arrows";
  if (k.includes("dart")) return "darts";
  return null;
}

/** whether the (possibly upgraded) weapon fires this ammo — family first
 *  (crossbows → bolts, bows → arrows, blowpipe → darts), then tier (dragon
 *  bolts need a dragon-tier crossbow) */
function weaponFires(weaponName: string | undefined, ammoName: string): boolean {
  const w = ownedKey(weaponName ?? "");
  const a = ownedKey(ammoName);
  const fam = ammoFamily(ammoName);
  if (w.includes("blowpipe")) return fam === "darts";
  if (w.includes("crossbow")) {
    return fam === "bolts" && (!a.includes("dragon bolt") || DRAGON_BOLT_CROSSBOWS.has(w));
  }
  if (w.includes("bow")) return fam === "arrows";
  return true; // unknown weapon — don't over-restrict
}

/** preset is F2P-only when the boss is F2P and the preset says so by name —
 *  same convention as the data-integrity suite (Obor/Bryophyta carry both) */
function isF2PPreset(boss: Boss, preset: BossPreset): boolean {
  return !boss.members && preset.name.toLowerCase().includes("f2p");
}

/** does the candidate beat the incumbent? strictly on score, or on tank
 *  slots with a score tie and strictly better defence */
function beats(score: number, defGain: number, slotKey: SlotKey, fromScore: number): boolean {
  return score > fromScore || (score === fromScore && defGain > 0 && TANK_SLOTS.has(slotKey));
}

/** mechanic/synergy gear the optimizer must never touch in this preset */
function untouchable(preset: BossPreset, slotKey: SlotKey, itemName: string): boolean {
  if (UTILITY_ITEMS.has(ownedKey(itemName))) return true;
  if (OBSIDIAN_WEAPONS.has(ownedKey(preset.slots.weapon ?? ""))) {
    return slotKey === "weapon" || OBSIDIAN_ARMOUR.has(ownedKey(itemName));
  }
  return false;
}

interface Candidate {
  item: GearItem;
  score: number;
  defGain: number;
  owned: boolean;
  /** GE price (null = untradeable); owned candidates cost nothing */
  price: number | null;
  locks: LockReason[];
}

interface SlotPlan {
  slotKey: SlotKey;
  fromName: string;
  fromScore: number;
  ranked: Candidate[]; // sorted best-first, all beat the incumbent
}

function planSlot(
  boss: Boss,
  preset: BossPreset,
  style: string,
  slotKey: SlotKey,
  fromName: string,
  weaponName: string | undefined,
  input: OptimizerInput,
): SlotPlan | null {
  const from = gearFor(fromName);
  if (!from) return null; // unknown item — the build should have caught it
  if (untouchable(preset, slotKey, fromName)) return null; // mechanic gear stays
  const fromScore = styleScore(from, style);
  const fromDef = defScore(from);
  const hasShield = preset.slots.shield !== undefined;
  // the preset's ammo constrains the weapon: a swap that orphans the ammo
  // slot (crossbow in place of a blowpipe, darts left unusable) is no upgrade
  const presetAmmo = preset.slots.ammo ?? null;
  const f2p = isF2PPreset(boss, preset);

  const cands: Candidate[] = [];
  for (const cand of GEAR) {
    if (itemSlotKey(cand) !== slotKey) continue;
    if (f2p && cand.members) continue; // keep F2P loadouts F2P
    if (UTILITY_ITEMS.has(ownedKey(cand.name))) continue;
    if (slotKey === "weapon" && cand.slot === "Two-handed" && hasShield) continue;
    if (slotKey === "weapon" && presetAmmo && !weaponFires(cand.name, presetAmmo)) continue;
    if (slotKey === "ammo" && !weaponFires(weaponName, cand.name)) continue;
    const score = styleScore(cand, style);
    const defGain = defScore(cand) - fromDef;
    if (!beats(score, defGain, slotKey, fromScore)) continue;
    const owned = input.ownedIndex!.has(ownedKey(cand.name));
    cands.push({
      item: cand,
      score,
      defGain,
      owned,
      price: owned ? null : cand.price,
      locks: computeItemLocks(cand, input.player, input.completed),
    });
  }
  if (cands.length === 0) return null;
  cands.sort(
    (a, b) =>
      b.score - a.score ||
      b.defGain - a.defGain ||
      (a.price ?? Infinity) - (b.price ?? Infinity),
  );
  return { slotKey, fromName, fromScore, ranked: cands };
}

export function optimizeLoadout(
  boss: Boss,
  preset: BossPreset,
  input: OptimizerInput,
): LoadoutOptimization | null {
  if (!input.ownedIndex) return null; // no items import → can't personalise
  const entries = Object.entries(preset.slots) as [SlotKey, string][];
  if (entries.length === 0) return null; // note-only preset (e.g. Gauntlet)

  const style = presetStyle(boss, preset);
  const plans = new Map<SlotKey, SlotPlan>();
  const evaluate = (slotKey: SlotKey, name: string, weaponName?: string) => {
    const plan = planSlot(boss, preset, style, slotKey, name, weaponName, input);
    if (plan) plans.set(slotKey, plan);
  };

  // first pass against the incumbent weapon; ammo gets re-checked once the
  // weapon is settled in case the upgrade changed its ammo family or tier
  for (const [slotKey, name] of entries) evaluate(slotKey, name, preset.slots.weapon);

  const upgrades: SlotUpgrade[] = [];
  const nearMisses: SlotNearMiss[] = [];
  let budget = input.coins ?? 0; // no coins imported → purchases never fire

  // walk the ranking: first owned-or-affordable candidate wins (a mid-tier
  // buy lands when the pool's best is out of reach)
  const take = (plan: SlotPlan): SlotUpgrade | null => {
    for (const c of plan.ranked) {
      if (c.locks.length > 0) continue;
      if (c.owned) {
        const up: SlotUpgrade = {
          slotKey: plan.slotKey, fromName: plan.fromName, fromScore: plan.fromScore,
          toItem: c.item, toScore: c.score, gain: c.score - plan.fromScore, defGain: c.defGain,
          source: "owned", price: null,
        };
        upgrades.push(up);
        return up;
      }
      if (c.price !== null && c.price <= budget) {
        budget -= c.price;
        const up: SlotUpgrade = {
          slotKey: plan.slotKey, fromName: plan.fromName, fromScore: plan.fromScore,
          toItem: c.item, toScore: c.score, gain: c.score - plan.fromScore, defGain: c.defGain,
          source: "buy", price: c.price,
        };
        upgrades.push(up);
        return up;
      }
    }
    return null;
  };

  // empty slots get one explanation: the best option blocked by *you* (locks,
  // budget, untradeable), not merely out-ranked by what was taken
  const explain = (plan: SlotPlan) => {
    for (const c of plan.ranked) {
      const near: SlotNearMiss = {
        slotKey: plan.slotKey, item: c.item, gain: c.score - plan.fromScore, defGain: c.defGain,
        price: c.price, locks: c.locks, owned: c.owned,
        reason: c.locks.length > 0 ? "locked" : c.price === null ? "untradeable" : "over-budget",
      };
      if (near.reason === "over-budget" && input.coins === null) continue; // can't blame a budget we don't know
      nearMisses.push(near);
      return;
    }
  };

  const settle = (plan: SlotPlan) => {
    if (!take(plan)) explain(plan);
  };

  // weapon first (its family/tier gates ammo), then ammo, then the rest by
  // best reachable gain so a tight budget buys the biggest comfort first
  const weaponPlan = plans.get("weapon");
  const weaponUp = weaponPlan ? take(weaponPlan) : null;
  if (weaponPlan && !weaponUp) explain(weaponPlan);
  const finalWeapon = weaponUp ? weaponUp.toItem.name : preset.slots.weapon;
  if (preset.slots.ammo) {
    evaluate("ammo", preset.slots.ammo, finalWeapon);
    const ammoPlan = plans.get("ammo");
    if (ammoPlan) settle(ammoPlan);
  }
  const rest = [...plans.values()]
    .filter((p) => p.slotKey !== "weapon" && p.slotKey !== "ammo")
    .sort((a, b) => bestReach(b) - bestReach(a));
  for (const plan of rest) settle(plan);

  if (upgrades.length === 0 && nearMisses.length === 0) return null;
  const buys = upgrades.filter((u) => u.source === "buy");
  const totalCost = buys.reduce((a, u) => a + (u.price ?? 0), 0);
  const order = new Map(SLOT_KEYS.map((k, i) => [k, i] as const));
  upgrades.sort((a, b) => order.get(a.slotKey)! - order.get(b.slotKey)!);
  nearMisses.sort((a, b) => order.get(a.slotKey)! - order.get(b.slotKey)!);
  return {
    style,
    upgrades,
    nearMisses,
    buyCount: buys.length,
    totalCost,
    withinBudget: input.coins !== null ? totalCost <= input.coins : null,
  };
}

/** the strongest candidate this slot could reach (for walk ordering) */
function bestReach(p: SlotPlan): number {
  return p.ranked[0].score - p.fromScore;
}
