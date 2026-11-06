import { describe, it, expect } from "vitest";
import {
  combatLevel,
  levelForXp,
  normalizePlayer,
  questPointsAwarded,
  totalQuestPoints,
  xpForLevel,
} from "./quest-data";
import { QUESTS } from "./quest-data";

describe("xp table", () => {
  it("has sane endpoints and is monotonic", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(83);
    expect(xpForLevel(99)).toBeGreaterThan(13_000_000);
    for (let lvl = 2; lvl <= 99; lvl++) {
      expect(xpForLevel(lvl)).toBeGreaterThan(xpForLevel(lvl - 1));
    }
  });

  it("round-trips through levelForXp", () => {
    for (const lvl of [1, 2, 10, 50, 70, 99]) {
      expect(levelForXp(xpForLevel(lvl))).toBe(lvl);
    }
  });
});

describe("combatLevel", () => {
  it("matches the standard OSRS formula", () => {
    // 70/70/70/70 melee with 1 range/mage/prayer → base 35 + melee 45.5 = 80
    const lvl = combatLevel({
      Attack: 70, Strength: 70, Defence: 70, Hitpoints: 70,
      Ranged: 1, Magic: 1, Prayer: 1,
    });
    expect(lvl).toBe(80);
  });
});

describe("normalizePlayer", () => {
  it("fills in a missing xp block from legacy saves", () => {
    const p = normalizePlayer({ levels: { Attack: 70 }, source: "manual" });
    expect(p?.levels.Attack).toBe(70);
    expect(p?.xp).toEqual({});
  });

  it("rejects unusable payloads", () => {
    expect(normalizePlayer(null)).toBeNull();
    expect(normalizePlayer({})).toBeNull();
    expect(normalizePlayer({ levels: "nope" })).toBeNull();
  });

  it("accepts the character-export source", () => {
    const p = normalizePlayer({ levels: { Attack: 70 }, source: "character-export" });
    expect(p?.source).toBe("character-export");
  });
});

describe("quest points", () => {
  it("awards 1 per quest, 0 for miniquests/activities", () => {
    const qp = questPointsAwarded(QUESTS.find((q) => q.key === "cooks assistant")!);
    expect(qp).toBe(1);
    const miniquest = QUESTS.find((q) => q.difficulty === "Miniquest");
    if (miniquest) expect(questPointsAwarded(miniquest)).toBe(0);
  });

  it("totals over a completed set", () => {
    const total = totalQuestPoints(["cooks assistant", "black knights fortress"]);
    expect(total).toBe(2);
  });
});
