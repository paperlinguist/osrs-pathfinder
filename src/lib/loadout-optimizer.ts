import {
  GEAR,
  SLOT_KEYS,
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
import { computeItemLocks } from "./boss-readiness";

/**
 * Per-preset comfort optimizer — "the budget tier gets me through, but I own
 * (or can easily buy) better; what should I actually wear?"
 *
 * For every slot of a preset it finds the best item in the planner's gear
 * pool that (a) scores higher than the preset pick for the boss's style,
 * (b) is equippable right now (levels + quest gates), and (c) is either
 * already in the imported bank/equipment or buyable — with the purchases
 * together staying inside the imported coin pile. Each slot gets the pool's
 * best available item, so the result is the preset bumped to the strongest
 * loadout you could field today.
 *
 * Scoring is the same deliberately-transparent styleScore as the upgrade
 * advisor (attack + damage bonus; defence and attack speed ignored — no DPS
 * formula is pretended). Three safety rules keep suggestions sane:
 *
 *  - mechanic gear is untouchable (UTILITY_ITEMS): items chosen for a fight
 *    mechanic the score can't see are never swapped out nor suggested into
 *    other loadouts;
 *  - shapes must fit: two-handed weapons never displace a filled off-hand,
 *    and a weapon upgrade must fire the ammo the preset already uses — so a
 *    crossbow never walks in where darts belong (or vice versa);
 *  - ammo stays inside the weapon's family (crossbows → bolts, bows →
 *    arrows, blowpipe → darts), re-checked after the weapon is resolved.
 */

export interface SlotUpgrade {
  slotKey: SlotKey;
  fromName: string;
  fromScore: number;
  toItem: GearItem;
  toScore: number;
  /** styleScore delta — the comfort gained */
  gain: number;
  source: "owned" | "buy";
  /** buy price; null for owned upgrades (they're free) */
  price: number | null;
}

export interface LoadoutOptimization {
  style: string;
  /** SLOT_KEYS display order */
  upgrades: SlotUpgrade[];
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

type AmmoFamily = "bolts" | "arrows" | "darts";

function ammoFamily(name: string): AmmoFamily | null {
  const k = ownedKey(name);
  if (k.includes("bolt")) return "bolts";
  if (k.includes("arrow")) return "arrows";
  if (k.includes("dart")) return "darts";
  return null;
}

/** whether the (possibly upgraded) weapon fires that ammo family */
function weaponFires(weaponName: string | undefined, family: AmmoFamily): boolean {
  const w = ownedKey(weaponName ?? "");
  if (w.includes("blowpipe")) return family === "darts";
  if (w.includes("crossbow")) return family === "bolts";
  if (w.includes("bow")) return family === "arrows";
  return true; // unknown weapon — don't over-restrict
}

/** preset is F2P-only when the boss is F2P and the preset says so by name —
 *  same convention as the data-integrity suite (Obor/Bryophyta carry both) */
function isF2PPreset(boss: Boss, preset: BossPreset): boolean {
  return !boss.members && preset.name.toLowerCase().includes("f2p");
}

interface SlotPlan {
  slotKey: SlotKey;
  fromName: string;
  fromScore: number;
  bestOwned: { item: GearItem; score: number } | null;
  /** best purchasable candidate — affordability is decided by the walk */
  bestBuy: { item: GearItem; score: number; price: number } | null;
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
  if (UTILITY_ITEMS.has(ownedKey(fromName))) return null; // mechanic gear stays
  const fromScore = styleScore(from, style);
  const hasShield = preset.slots.shield !== undefined;
  const fromAmmo = slotKey === "ammo" ? ammoFamily(fromName) : null;
  // the preset's ammo constrains the weapon: a swap that orphans the ammo
  // slot (crossbow in place of a blowpipe, darts left unusable) is no upgrade
  const presetAmmo = preset.slots.ammo ? ammoFamily(preset.slots.ammo) : null;
  const f2p = isF2PPreset(boss, preset);

  const plan: SlotPlan = { slotKey, fromName, fromScore, bestOwned: null, bestBuy: null };
  for (const cand of GEAR) {
    if (itemSlotKey(cand) !== slotKey) continue;
    if (f2p && cand.members) continue; // keep F2P loadouts F2P
    if (UTILITY_ITEMS.has(ownedKey(cand.name))) continue;
    if (computeItemLocks(cand, input.player, input.completed).length > 0) continue;
    if (slotKey === "weapon" && cand.slot === "Two-handed" && hasShield) continue;
    if (slotKey === "weapon" && presetAmmo && !weaponFires(cand.name, presetAmmo)) continue;
    if (fromAmmo) {
      const fam = ammoFamily(cand.name);
      if (!fam || fam !== fromAmmo || !weaponFires(weaponName, fam)) continue;
    }
    const score = styleScore(cand, style);
    if (score <= fromScore) continue;
    if (input.ownedIndex!.has(ownedKey(cand.name))) {
      if (!plan.bestOwned || score > plan.bestOwned.score) plan.bestOwned = { item: cand, score };
    } else if (input.coins !== null && cand.price !== null) {
      if (!plan.bestBuy || score > plan.bestBuy.score) plan.bestBuy = { item: cand, score, price: cand.price };
    }
  }
  return plan;
}

/** the strongest candidate this slot could reach (for walk ordering) */
function bestGain(p: SlotPlan): number {
  return Math.max(p.bestOwned?.score ?? 0, p.bestBuy?.score ?? 0) - p.fromScore;
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
  // weapon is settled in case the upgrade changed its ammo family
  for (const [slotKey, name] of entries) evaluate(slotKey, name, preset.slots.weapon);

  const upgrades: SlotUpgrade[] = [];
  let budget = input.coins ?? 0; // no coins imported → buy candidates never exist
  const take = (plan: SlotPlan): SlotUpgrade | null => {
    const useBuy =
      plan.bestBuy !== null &&
      (!plan.bestOwned || plan.bestBuy.score > plan.bestOwned.score) &&
      plan.bestBuy.price <= budget;
    if (useBuy) {
      const { item, score, price } = plan.bestBuy!;
      budget -= price;
      const up: SlotUpgrade = {
        slotKey: plan.slotKey, fromName: plan.fromName, fromScore: plan.fromScore,
        toItem: item, toScore: score, gain: score - plan.fromScore, source: "buy", price,
      };
      upgrades.push(up);
      return up;
    }
    if (plan.bestOwned) {
      const { item, score } = plan.bestOwned;
      const up: SlotUpgrade = {
        slotKey: plan.slotKey, fromName: plan.fromName, fromScore: plan.fromScore,
        toItem: item, toScore: score, gain: score - plan.fromScore, source: "owned", price: null,
      };
      upgrades.push(up);
      return up;
    }
    return null;
  };

  // weapon first (its family gates ammo), then ammo, then the rest by best
  // reachable gain so a tight budget buys the biggest comfort first
  const weaponUp = plans.has("weapon") ? take(plans.get("weapon")!) : null;
  const finalWeapon = weaponUp ? weaponUp.toItem.name : preset.slots.weapon;
  if (preset.slots.ammo) {
    evaluate("ammo", preset.slots.ammo, finalWeapon);
    if (plans.has("ammo")) take(plans.get("ammo")!);
  }
  const rest = [...plans.values()]
    .filter((p) => p.slotKey !== "weapon" && p.slotKey !== "ammo")
    .sort((a, b) => bestGain(b) - bestGain(a));
  for (const plan of rest) take(plan);

  if (upgrades.length === 0) return null; // nothing beats the preset as-is
  const buys = upgrades.filter((u) => u.source === "buy");
  const totalCost = buys.reduce((a, u) => a + (u.price ?? 0), 0);
  const order = new Map(SLOT_KEYS.map((k, i) => [k, i] as const));
  upgrades.sort((a, b) => order.get(a.slotKey)! - order.get(b.slotKey)!);
  return {
    style,
    upgrades,
    buyCount: buys.length,
    totalCost,
    withinBudget: input.coins !== null ? totalCost <= input.coins : null,
  };
}
