import { describe, it, expect } from "vitest";
import {
  nextMilestone,
  pendingQuestXp,
  skillRewards,
  skillUnlocks,
} from "./skill-explorer";
import { QUESTS, type PlayerSkills } from "./quest-data";

const opts = { allowBoosts: true, includeQuestXp: true };
const noPlayer: PlayerSkills = { levels: {}, xp: {}, source: "manual" };

describe("skillRewards", () => {
  it("lists quests granting XP in the skill, best-first", () => {
    const rows = skillRewards("Attack", noPlayer, new Set(), opts);
    expect(rows.length).toBeGreaterThan(10);
    const waterfall = rows.find((r) => r.key === "waterfall quest");
    expect(waterfall?.xp).toBe(13750);
    // every row grants XP in the skill
    for (const r of rows) {
      const q = QUESTS.find((x) => x.key === r.key)!;
      expect(q.xp.Attack).toBe(r.xp);
    }
  });

  it("marks completed quests and gates the rest", () => {
    const done = new Set(["waterfall quest"]);
    const rows = skillRewards("Attack", noPlayer, done, opts);
    expect(rows.find((r) => r.key === "waterfall quest")?.status).toBe("completed");
    // a quest with skill reqs and no prereqs, uncompleted and no player → gated on levels
    const anyQuest = rows.find((r) => r.status === "gated");
    expect(anyQuest).toBeTruthy();
    expect(anyQuest!.gates.length).toBeGreaterThan(0);
  });

  it("reports ready for a quest whose requirements the player meets", () => {
    // Waterfall Quest has no skill requirements — ready for anyone
    const rows = skillRewards("Attack", noPlayer, new Set(), opts);
    expect(rows.find((r) => r.key === "waterfall quest")?.status).toBe("ready");
  });
});

describe("skillUnlocks", () => {
  it("includes diary tiers alongside quests", () => {
    const rows = skillUnlocks("Thieving", null, null);
    const diaries = rows.filter((r) => r.isDiary);
    expect(diaries.length).toBeGreaterThan(5);
    expect(rows.find((r) => r.key === "ardougne easy")?.required).toBe(5);
  });

  it("splits unlocked vs locked by the player's level", () => {
    const rows = skillUnlocks("Ranged", { levels: { Ranged: 70 }, xp: {}, source: "manual" }, new Set());
    const unlocked = rows.filter((r) => r.unlocked === true);
    const locked = rows.filter((r) => r.unlocked === false);
    expect(unlocked.every((u) => u.required <= 70)).toBe(true);
    expect(locked.every((u) => u.required > 70)).toBe(true);
  });
});

describe("milestones and pending XP", () => {
  it("computes the next round level and XP gap", () => {
    const m = nextMilestone("Agility", { levels: { Agility: 62 }, xp: { Agility: 350538 }, source: "manual" });
    expect(m?.level).toBe(70);
    expect(m?.xpNeeded).toBeGreaterThan(0);
    expect(m?.hours).toBeTruthy();
  });

  it("returns null at 99", () => {
    expect(nextMilestone("Agility", { levels: { Agility: 99 }, xp: { Agility: 13034431 }, source: "manual" })).toBeNull();
  });

  it("sums quest XP still available", () => {
    const noDone = pendingQuestXp("Attack", null);
    const withDone = pendingQuestXp("Attack", new Set(["waterfall quest"]));
    expect(noDone).toBeGreaterThan(withDone);
    expect(noDone - withDone).toBe(13750);
  });
});
