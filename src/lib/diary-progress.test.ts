import { describe, it, expect } from "vitest";
import { diaryProgress } from "./diary-progress";
import { DIARY_BY_KEY, type PlayerSkills } from "./quest-data";

const player = (levels: Record<string, number>): PlayerSkills => ({
  levels,
  xp: {},
  source: "manual",
});

describe("diaryProgress", () => {
  const karamja = DIARY_BY_KEY["karamja medium"]; // has skills + quests

  it("is unknown with no character or completion data", () => {
    const r = diaryProgress(karamja, null, null);
    expect(r.status).toBe("unknown");
  });

  it("is done when the tier key is in the completions set", () => {
    const r = diaryProgress(karamja, null, new Set(["karamja medium"]));
    expect(r.status).toBe("done");
  });

  it("is ready when every skill and quest requirement is met", () => {
    // build a maxed char so all skills pass, and complete every quest
    const r = diaryProgress(
      karamja,
      player(Object.fromEntries(Object.keys(karamja.skills).map((s) => [s, 99]))),
      new Set(karamja.quests),
    );
    expect(r.status).toBe("ready");
    expect(r.skillGaps).toHaveLength(0);
    expect(r.questGaps).toHaveLength(0);
  });

  it("counts skill and quest gaps for ranking", () => {
    const r = diaryProgress(karamja, player({}), new Set());
    expect(r.status).toBe("incomplete");
    expect(r.remainingCount).toBe(
      Object.keys(karamja.skills).length + karamja.quests.length,
    );
    expect(r.skillGaps.every((g) => g.current === 1)).toBe(true);
  });

  it("never reports ready while quest state is unknown", () => {
    const maxed = Object.fromEntries(Object.keys(karamja.skills).map((s) => [s, 99]));
    const r = diaryProgress(karamja, player(maxed), null);
    expect(r.status).toBe("incomplete"); // quests unknown, not ready
  });
});
