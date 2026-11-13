import { describe, it, expect } from "vitest";
import { missingPrereqClosure, questSkillGaps, resolveChain } from "./resolver";
import { QUEST_BY_KEY, QUESTS, type PlayerSkills } from "./quest-data";

const noPlayer: PlayerSkills = { levels: {}, xp: {}, source: "manual" };
const opts = { allowBoosts: true, includeQuestXp: true };

describe("resolveChain", () => {
  it("resolves a trivial quest with no steps (the target itself is a target, not a step)", () => {
    const r = resolveChain(["cooks assistant"], noPlayer, new Set(), opts);
    expect(r).not.toBeNull();
    expect(r?.steps).toHaveLength(0); // no prerequisites
    expect(r?.targets[0].quest.key).toBe("cooks assistant");
  });

  it("pulls prerequisite quests into the plan steps", () => {
    // "Recipe for Disaster - Another Cook's Quest" requires Cook's Assistant
    const r = resolveChain(
      ["recipe for disaster another cooks quest"],
      noPlayer,
      new Set(),
      opts,
    );
    expect(r).not.toBeNull();
    const stepKeys = r!.steps.map((s) => s.quest.key);
    expect(stepKeys).toContain("cooks assistant");
    expect(r!.targets.map((t) => t.quest.key)).toContain("recipe for disaster another cooks quest");
  });

  it("excludes already-completed quests from the steps", () => {
    const r = resolveChain(
      ["recipe for disaster another cooks quest"],
      noPlayer,
      new Set(["cooks assistant"]),
      opts,
    );
    const stepKeys = r!.steps.map((s) => s.quest.key);
    expect(stepKeys).not.toContain("cooks assistant");
    expect(r!.targets.map((t) => t.quest.key)).toContain("recipe for disaster another cooks quest");
  });

  it("returns null when no targets resolve", () => {
    expect(resolveChain([], noPlayer, new Set(), opts)).toBeNull();
    expect(resolveChain(["not-a-quest"], noPlayer, new Set(), opts)).toBeNull();
  });
});

describe("resolveChain — diary targets", () => {
  it("pulls the lower tiers and quest prerequisites of a diary into the plan", () => {
    // Karamja Elite: wiki requires the Easy/Medium/Hard tiers done to claim
    // the Elite reward, plus The Grand Tree / Tai Bwo Wannai Trio
    const r = resolveChain(["karamja elite"], noPlayer, new Set(), opts);
    expect(r).not.toBeNull();
    const stepKeys = r!.steps.map((s) => s.quest.key);
    expect(stepKeys).toContain("karamja easy");
    expect(stepKeys).toContain("karamja medium");
    expect(stepKeys).toContain("karamja hard");
    expect(stepKeys).toContain("grand tree");
    expect(stepKeys).toContain("tai bwo wannai trio");
    expect(r!.targets.map((t) => t.quest.key)).toEqual(["karamja elite"]);
  });

  it("orders diary tiers Easy → Medium → Hard → Elite", () => {
    const r = resolveChain(["karamja elite"], noPlayer, new Set(), opts);
    const pos = (k: string) => r!.steps.findIndex((s) => s.quest.key === k);
    expect(pos("karamja easy")).toBeLessThan(pos("karamja medium"));
    expect(pos("karamja medium")).toBeLessThan(pos("karamja hard"));
  });

  it("skips completed lower tiers but keeps unfinished ones", () => {
    const r = resolveChain(
      ["karamja elite"],
      noPlayer,
      new Set(["karamja easy", "karamja medium"]),
      opts,
    );
    const stepKeys = r!.steps.map((s) => s.quest.key);
    expect(stepKeys).not.toContain("karamja easy");
    expect(stepKeys).not.toContain("karamja medium");
    expect(stepKeys).toContain("karamja hard");
  });

  it("surfaces the diary's own skill gates on the target (Karamja Elite Runecraft 91)", () => {
    // diary skills are boostable per the wiki overview — boost-ok when boosts
    // are allowed, a real training gate when they aren't
    const boosted = resolveChain(["karamja elite"], noPlayer, new Set(), opts);
    const rcB = boosted!.targets[0].gaps.find((g) => g.skill === "Runecraft");
    expect(rcB?.required).toBe(91);
    expect(rcB?.status).toBe("boost-ok");
    const strict = resolveChain(
      ["karamja elite"],
      noPlayer,
      new Set(),
      { allowBoosts: false, includeQuestXp: true },
    );
    const rcS = strict!.targets[0].gaps.find((g) => g.skill === "Runecraft");
    expect(rcS?.status).toBe("train");
    expect(strict!.skillTotals.find((g) => g.skill === "Runecraft")?.xpNeeded).toBeGreaterThan(0);
  });

  it("treats an all-quests diary tier as a quest-cape-sized plan (Lumbridge Elite)", () => {
    const r = resolveChain(["lumbridge-and-draynor elite"], noPlayer, new Set(), opts);
    expect(r).not.toBeNull();
    // easy + medium + hard pulled in as steps, plus every non-completed quest
    const diarySteps = r!.steps.filter((s) =>
      s.quest.key.startsWith("lumbridge-and-draynor "),
    );
    expect(diarySteps.length).toBe(3);
    expect(r!.steps.length).toBeGreaterThanOrEqual(QUESTS.length - 1);
  });

  it("dedupes a lower diary tier tracked alongside a higher one", () => {
    // tracking Hard AND Elite: Hard is a step for Elite but also a target —
    // the plan must not double-place it and must keep exactly one copy
    const r = resolveChain(["karamja hard", "karamja elite"], noPlayer, new Set(), opts);
    expect(r).not.toBeNull();
    const keys = r!.steps.map((s) => s.quest.key);
    expect(keys.filter((k) => k === "karamja hard")).toHaveLength(1);
    expect(r!.targets.map((t) => t.quest.key)).toEqual(["karamja hard", "karamja elite"]);
  });

  it("mixes diaries with quest targets in one merged plan", () => {
    const r = resolveChain(["desert treasure ii fallen empire", "ardougne hard"], noPlayer, new Set(), opts);
    expect(r).not.toBeNull();
    const targetKeys = r!.targets.map((t) => t.quest.key);
    expect(targetKeys).toContain("desert treasure ii fallen empire");
    expect(targetKeys).toContain("ardougne hard");
    const stepKeys = r!.steps.map((s) => s.quest.key);
    expect(stepKeys).toContain("ardougne easy");
    expect(stepKeys).toContain("ardougne medium");
  });

  it("plans Karamja Elite end-to-end for a mid-level player (no boosts)", () => {
    // typical mid-game account: most Karamja-tier skills covered, RC not
    const mid: PlayerSkills = {
      levels: { Mining: 62, Agility: 55, Strength: 60, Herblore: 55, Fishing: 68, Ranged: 55, Thieving: 55, Cooking: 60, Crafting: 55, Magic: 70, Woodcutting: 60, Slayer: 55, Farming: 50, Hunter: 45, Combat: 105 },
      xp: {},
      combatLevel: 105,
      source: "manual",
    };
    const r = resolveChain(
      ["karamja elite"],
      mid,
      new Set(["karamja easy", "grand tree", "shilo village", "tai bwo wannai trio", "dragon slayer i"]),
      { allowBoosts: false, includeQuestXp: true },
    );
    expect(r).not.toBeNull();
    const keys = r!.steps.map((s) => s.quest.key);
    // completed tiers/quests are excluded…
    expect(keys).not.toContain("karamja easy");
    expect(keys).not.toContain("grand tree");
    // …unfinished tiers remain steps, in order
    expect(keys).toContain("karamja medium");
    expect(keys).toContain("karamja hard");
    expect(keys.indexOf("karamja medium")).toBeLessThan(keys.indexOf("karamja hard"));
    // the real grinds surface: Runecraft 91 / Herblore 87 / Farming 72
    const skills = r!.skillTotals.map((g) => g.skill);
    expect(skills).toContain("Runecraft");
    expect(skills).toContain("Herblore");
    expect(skills).toContain("Farming");
    // QP gate: Karamja Elite needs 107, the plan's estQp comes from completions (5)
    expect(r!.targets[0].quest.qp).toBe(107);
  });
});

describe("questSkillGaps", () => {
  it("flags an unmet skill requirement as needing training", () => {
    const q = QUEST_BY_KEY["a kingdom divided"]; // 54 Agility etc.
    if (!q) return;
    const gaps = questSkillGaps(q, { levels: { Agility: 1 }, xp: {}, source: "manual" }, opts);
    const agi = gaps.find((g) => g.skill === "Agility");
    expect(agi?.status).toBe("train");
    expect(agi?.required).toBe(54);
  });
});

describe("missingPrereqClosure", () => {
  it("returns the transitive prereq closure excluding completed/planned", () => {
    const closure = missingPrereqClosure(
      "recipe for disaster another cooks quest",
      new Set(),
      new Set(),
    );
    expect(closure).toContain("cooks assistant");
  });
});
