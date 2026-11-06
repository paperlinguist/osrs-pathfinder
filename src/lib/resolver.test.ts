import { describe, it, expect } from "vitest";
import { missingPrereqClosure, questSkillGaps, resolveChain } from "./resolver";
import { QUEST_BY_KEY, type PlayerSkills } from "./quest-data";

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
