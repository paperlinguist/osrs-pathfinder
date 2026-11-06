import { BOSSES, gearFor, itemSlotKey, styleScore, type GearItem, type SlotKey } from "./boss-data";
import { ownedKey, type OwnedEntry } from "./character-export";
import type { PlayerSkills } from "./quest-data";
import { computeItemLocks, type LockReason } from "./boss-readiness";

/**
 * Cross-boss upgrade advisor — "what should I buy next?"
 *
 * For every item referenced by any boss preset that you DON'T own, decide
 * whether it's a real upgrade for that style: compare its style score
 * (attack + damage bonus — see styleScore) against the best item you own in
 * the same slot for the same style. Items that don't beat what you have are
 * skipped; the rest are grouped by what's holding them back: nothing
 * (buy-now / save-up by budget) or equip/quest gates (locked).
 */

export interface UpgradeSuggestion {
  item: GearItem;
  slotKey: SlotKey;
  /** styles of the presets wanting this item */
  styles: string[];
  /** boss keys whose presets reference it */
  bossKeys: string[];
  /** display strings like "Fight Caves · Budget" (deduped, capped for UI) */
  presetLabels: string[];
  /** your best owned item in this slot for the best style, if any */
  ownedBestName: string | null;
  /** style-score gain over that owned best (full score when slot is empty) */
  gain: number;
  score: number;
  price: number | null;
  locks: LockReason[];
  affordable: boolean | null;
}

export interface UpgradeReport {
  /** unlocked & within budget */
  buyNow: UpgradeSuggestion[];
  /** unlocked but over budget */
  saveUp: UpgradeSuggestion[];
  /** unlocked but untradeable — no GE price can rank them */
  earn: UpgradeSuggestion[];
  /** equip-level or quest gates first */
  locked: UpgradeSuggestion[];
  /** sum of buy-now prices (0 when none) */
  buyNowTotal: number;
}

const ALL_STYLES = ["Melee", "Ranged", "Magic"] as const;

export interface AdvisorInput {
  player: PlayerSkills | null;
  completed: Set<string> | null;
  ownedIndex: Map<string, OwnedEntry>;
  coins: number | null;
}

export function suggestUpgrades(input: AdvisorInput): UpgradeReport {
  /* 1. index every preset item reference: name → styles/bosses/presets */
  const refs = new Map<
    string,
    { slotKey: SlotKey | null; styles: Set<string>; bossKeys: Set<string>; presetLabels: Set<string> }
  >();
  for (const boss of BOSSES) {
    for (const preset of boss.presets) {
      const style = boss.styles[0] ?? "Melee";
      for (const name of Object.values(preset.slots)) {
        const cur = refs.get(name) ?? {
          slotKey: null, styles: new Set<string>(), bossKeys: new Set<string>(), presetLabels: new Set<string>(),
        };
        cur.styles.add(style);
        cur.bossKeys.add(boss.key);
        cur.presetLabels.add(`${boss.name} · ${preset.name}`);
        if (!cur.slotKey) cur.slotKey = itemSlotKey(gearFor(name)!) ?? null;
        refs.set(name, cur);
      }
    }
  }

  /* 2. best owned score per (slot, style) — upgrades must beat these */
  const bestOwned = new Map<string, { name: string; score: number }>();
  for (const [key] of input.ownedIndex) {
    const item = gearFor(key); // gear lookups are keyed by the same normalization
    if (!item) continue;
    const slot = itemSlotKey(item);
    if (!slot) continue;
    for (const style of ALL_STYLES) {
      const score = styleScore(item, style);
      if (score <= 0) continue;
      const k = `${slot}:${style}`;
      const cur = bestOwned.get(k);
      if (!cur || score > cur.score) bestOwned.set(k, { name: item.name, score });
    }
  }

  /* 3. classify every referenced-but-unowned item */
  const buyNow: UpgradeSuggestion[] = [];
  const saveUp: UpgradeSuggestion[] = [];
  const earn: UpgradeSuggestion[] = [];
  const locked: UpgradeSuggestion[] = [];

  for (const [name, ref] of refs) {
    if (!ref.slotKey) continue;
    const item = gearFor(name);
    if (!item) continue;
    if (input.ownedIndex.has(ownedKey(name))) continue;

    // best gain across the styles that actually want this item
    let gain = -Infinity;
    let ownedBestName: string | null = null;
    let score = 0;
    for (const style of ref.styles) {
      const s = styleScore(item, style);
      const best = bestOwned.get(`${ref.slotKey}:${style}`);
      const g = s - (best?.score ?? 0);
      if (g > gain) {
        gain = g;
        ownedBestName = best?.name ?? null;
        score = s;
      }
    }
    if (gain <= 0) continue; // you already own better in that slot — not an upgrade

    const locks = computeItemLocks(item, input.player, input.completed);
    const suggestion: UpgradeSuggestion = {
      item,
      slotKey: ref.slotKey,
      styles: [...ref.styles],
      bossKeys: [...ref.bossKeys],
      presetLabels: [...ref.presetLabels],
      ownedBestName,
      gain,
      score,
      price: item.price,
      locks,
      affordable:
        locks.length === 0 && item.price !== null && input.coins !== null
          ? item.price <= input.coins
          : null,
    };

    if (locks.length > 0) locked.push(suggestion);
    else if (suggestion.price === null) earn.push(suggestion); // untradeable: earn in game
    else if (suggestion.affordable === true) buyNow.push(suggestion);
    else saveUp.push(suggestion);
  }

  // biggest stat gain first (that's the actual upgrade), then how many bosses
  // want it, then cheapest — keeps "+1 for 17m" purchases at the bottom
  const rank = (a: UpgradeSuggestion, b: UpgradeSuggestion) =>
    b.gain - a.gain ||
    b.bossKeys.length - a.bossKeys.length ||
    (a.price ?? Infinity) - (b.price ?? Infinity);
  buyNow.sort(rank);
  saveUp.sort(rank);
  locked.sort(rank);

  return {
    buyNow,
    saveUp,
    earn,
    locked,
    buyNowTotal: buyNow.reduce((a, s) => a + (s.price ?? 0), 0),
  };
}
