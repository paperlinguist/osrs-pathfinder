import { describe, it, expect } from "vitest";
import { parseQuestStateExport } from "./quest-state-import";

describe("parseQuestStateExport", () => {
  it("parses Character Export numeric-id format", () => {
    const r = parseQuestStateExport({
      exported_at: "2026-11-06T12:00:00Z",
      summary: { finished: 1, in_progress: 1, not_started: 0 },
      quests: [
        { id: 0, name: "Animal Magnetism", state: "FINISHED" },
        { id: 31, name: "Dragon Slayer I", state: "IN_PROGRESS" },
      ],
    });
    expect(r?.source).toBe("character-export");
    expect(r?.finishedKeys).toContain("animal magnetism");
    expect(r?.notFinishedKeys).toContain("dragon slayer i");
    expect(r?.inProgressCount).toBe(1);
    expect(r?.timestampIso).toBe("2026-11-06T12:00:00Z");
  });

  it("parses Quest State Exporter enum-id format", () => {
    const r = parseQuestStateExport({
      rsn: "Wren",
      timestampIso: "2026-10-27T19:52:11Z",
      quests: {
        entries: [{ id: "ANIMAL_MAGNETISM", name: "Animal Magnetism", state: "FINISHED" }],
        questPoints: 5,
      },
    });
    expect(r?.source).toBe("quest-state-exporter");
    expect(r?.rsn).toBe("Wren");
    expect(r?.fileQuestPoints).toBe(5);
    expect(r?.finishedKeys).toContain("animal magnetism");
  });

  it("falls back to name for miniquests whose ids collide across id spaces", () => {
    // Daddy's Home carries cacheId 21 in our data, which collides with Death
    // Plateau's id — the entry name must win via corroboration + name fallback
    const r = parseQuestStateExport({
      quests: [{ id: 21, name: "Daddy's Home", state: "FINISHED" }],
    });
    expect(r?.finishedKeys).toContain("daddys home");
    expect(r?.finishedKeys).not.toContain("death plateau");
  });

  it("maps Recipe for Disaster subquest numeric ids", () => {
    const r = parseQuestStateExport({
      quests: [{ id: 2307, name: "Recipe for Disaster - Another Cook's Quest", state: "FINISHED" }],
    });
    expect(r?.finishedKeys).toContain("recipe for disaster another cooks quest");
  });

  it("returns null for unusable shapes", () => {
    expect(parseQuestStateExport(null)).toBeNull();
    expect(parseQuestStateExport(undefined)).toBeNull();
    expect(parseQuestStateExport({})).toBeNull();
    expect(parseQuestStateExport({ quests: { entries: [] } })).toBeNull();
    expect(parseQuestStateExport({ quests: [] })).toBeNull();
  });
});
