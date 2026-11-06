import { describe, it, expect } from "vitest";
import { BOSS_BY_KEY, gearFor } from "./boss-data";
import { computeItemLocks, evaluateBoss } from "./boss-readiness";
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
