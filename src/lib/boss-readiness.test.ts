import { describe, it, expect } from "vitest";
import { BOSS_BY_KEY, gearFor } from "./boss-data";
import { computeItemLocks, evaluateBoss, fieldablePreset } from "./boss-readiness";
import type { PlayerSkills } from "./quest-data";

const emptyInput = {
  player: null as PlayerSkills | null,
  completed: null as Set<string> | null,
  ownedIndex: null,
  coins: null,
};

describe("evaluateBoss", () => {
  const fc = BOSS_BY_KEY["fight-caves"];

  it("reports ready when required stats and quests are met", () => {
    const v = evaluateBoss(fc, {
      ...emptyInput,
      player: { levels: { Prayer: 46 }, xp: {}, source: "manual" },
      completed: new Set(),
    });
    expect(v.status).toBe("ready");
    expect(v.blockers).toHaveLength(0);
  });

  it("reports gated when a required skill is short", () => {
    const v = evaluateBoss(fc, {
      ...emptyInput,
      player: { levels: { Prayer: 30 }, xp: {}, source: "manual" },
      completed: new Set(),
    });
    expect(v.status).toBe("gated");
    expect(v.skillGaps.find((g) => g.skill === "Prayer")?.met).toBe(false);
  });

  it("reports unknown with no character imported", () => {
    const v = evaluateBoss(fc, emptyInput);
    expect(v.status).toBe("unknown");
  });
});

describe("computeItemLocks", () => {
  it("lists skill and quest gates for an item", () => {
    const acc = gearFor("Ava's accumulator"); // 50 Ranged + Animal Magnetism
    expect(acc).toBeTruthy();
    const locks = computeItemLocks(
      acc!,
      { levels: { Ranged: 30 }, xp: {}, source: "manual" },
      new Set(),
    );
    expect(locks).toContainEqual({ type: "level", skill: "Ranged", required: 50, current: 30 });
    expect(locks).toContainEqual({ type: "quest", key: "animal magnetism" });
  });

  it("is empty when all gates are met", () => {
    const acc = gearFor("Ava's accumulator")!;
    const locks = computeItemLocks(
      acc,
      { levels: { Ranged: 70 }, xp: {}, source: "manual" },
      new Set(["animal magnetism"]),
    );
    expect(locks).toEqual([]);
  });
});

describe("fieldablePreset", () => {
  // Obor's F2P melee preset is all-tradeable, no untradeables in the way
  const obor = BOSS_BY_KEY["obor"];
  const f2pmelee = { levels: { Attack: 40, Defence: 40, Ranged: 40 }, xp: {}, source: "manual" } as PlayerSkills;
  const owned = (names: string[]) =>
    new Map(names.map((n) => [n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), { quantity: 1, sources: ["bank" as const] }]));
  // rune platebody gates on Dragon Slayer I — completed for these checks
  const done = () => new Set(["dragon slayer i"]);
  const check = (o: string[], coins: number | null) =>
    evaluateBoss(obor, { player: f2pmelee, completed: done(), ownedIndex: owned(o), coins }).presets.find(
      (p) => p.preset.name === "F2P melee",
    )!;

  it("is true when everything is owned", () => {
    expect(fieldablePreset(check(["Rune full helm", "Amulet of strength", "Rune scimitar", "Rune kiteshield", "Rune platebody", "Green d'hide vambraces", "Rune platelegs", "Leather boots"], null), null)).toBe(true);
  });

  it("buys into fieldable within budget", () => {
    // nothing owned, but ~160k covers the whole rune set
    expect(fieldablePreset(check([], 999_999), 999_999)).toBe(true);
    expect(fieldablePreset(check([], 50_000), 50_000)).toBe(false);
  });

  it("stays false without an items import, for empty presets, or with unaffordable gaps", () => {
    const gauntlet = evaluateBoss(BOSS_BY_KEY["gauntlet"], { player: f2pmelee, completed: new Set(), ownedIndex: owned([]), coins: 999_999 }).presets[0];
    expect(fieldablePreset(gauntlet, 999_999)).toBe(false); // note-only preset
  });

  it("is blocked by equip locks even when affordable", () => {
    // 30 Defence can't wear the rune body/legs/shield/helm
    const low = { levels: { Attack: 40, Defence: 30, Ranged: 40 }, xp: {}, source: "manual" } as PlayerSkills;
    const p = evaluateBoss(obor, { player: low, completed: new Set(), ownedIndex: owned([]), coins: 999_999 }).presets.find((x) => x.preset.name === "F2P melee")!;
    expect(fieldablePreset(p, 999_999)).toBe(false);
  });
});
