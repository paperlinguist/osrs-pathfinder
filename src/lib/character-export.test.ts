import { describe, it, expect } from "vitest";
import {
  EMPTY_OWNED,
  buildOwnedIndex,
  mergeOwned,
  normalizeOwned,
  ownedKey,
  parseCharacterFile,
  parseContainerFile,
  readCharacterExportFiles,
  totalCoins,
} from "./character-export";

describe("parseCharacterFile", () => {
  it("maps Character Export stats to PlayerSkills", () => {
    const p = parseCharacterFile({
      account_name: "Wren von Arx",
      stats: {
        Attack: { real_level: 70, boosted_level: 75, experience: 739418 },
        Ranged: { real_level: 70, experience: 738473 },
      },
    });
    expect(p).not.toBeNull();
    expect(p?.source).toBe("character-export");
    expect(p?.username).toBe("Wren von Arx");
    expect(p?.levels.Attack).toBe(70);
    expect(p?.xp.Attack).toBe(739418);
    expect(p?.combatLevel).toBeTypeOf("number");
  });

  it("returns null when there is no stats block", () => {
    expect(parseCharacterFile({ account_name: "x" })).toBeNull();
    expect(parseCharacterFile(null)).toBeNull();
  });
});

describe("parseContainerFile", () => {
  it("parses bank/equipment/inventory containers", () => {
    const c = parseContainerFile({
      kind: "bank",
      item_count: 2,
      items: [
        { slot: 0, id: 995, quantity: 1000, name: "Coins" },
        { slot: 1, id: 837, quantity: 1, name: "Rune crossbow" },
      ],
    });
    expect(c?.kind).toBe("bank");
    expect(c?.items).toHaveLength(2);
  });

  it("rejects non-container shapes", () => {
    expect(parseContainerFile({ kind: "nope", items: [] })).toBeNull();
    expect(parseContainerFile({ kind: "bank" })).toBeNull();
    expect(parseContainerFile(null)).toBeNull();
  });
});

describe("ownedKey normalization", () => {
  it("unifies charge-suffix and variant forms", () => {
    expect(ownedKey("Amulet of glory(6)")).toBe("amulet of glory");
    expect(ownedKey("Amulet of glory#4")).toBe("amulet of glory");
    expect(ownedKey("Ring of dueling(8)")).toBe("ring of dueling");
    expect(ownedKey("Black d'hide body")).toBe("black d hide body");
  });
});

describe("owned-items merging", () => {
  it("merges containers and totals coins across them", () => {
    const merged = mergeOwned(EMPTY_OWNED, [
      {
        kind: "bank",
        items: [
          { id: 995, quantity: 500, name: "Coins" },
          { id: 1, quantity: 2, name: "Toolkit" },
        ],
      },
      {
        kind: "inventory",
        items: [{ id: 995, quantity: 120, name: "Coins" }],
      },
    ]);
    expect(merged.bank).toHaveLength(2);
    expect(merged.inventory).toHaveLength(1);
    expect(totalCoins(merged)).toBe(620);
  });

  it("builds an owned index across sources", () => {
    const owned = mergeOwned(EMPTY_OWNED, [
      { kind: "equipment", items: [{ id: 837, quantity: 1, name: "Rune crossbow" }] },
      { kind: "bank", items: [{ id: 837, quantity: 1, name: "Rune crossbow" }] },
    ]);
    const idx = buildOwnedIndex(owned);
    expect(idx.get("rune crossbow")?.quantity).toBe(2);
    expect(idx.get("rune crossbow")?.sources).toEqual(["bank", "equipment"]);
  });
});

describe("normalizeOwned", () => {
  it("tolerates garbage and returns a safe shape", () => {
    expect(normalizeOwned(null)).toEqual(EMPTY_OWNED);
    expect(normalizeOwned({})).toEqual(EMPTY_OWNED);
    expect(normalizeOwned({ bank: "not-an-array" }).bank).toEqual([]);
  });
});

describe("readCharacterExportFiles", () => {
  it("routes each file by shape", async () => {
    const files = [
      new File(
        [JSON.stringify({ account_name: "Wren", stats: { Attack: { real_level: 70 } } })],
        "character.json",
      ),
      new File([JSON.stringify({ kind: "bank", items: [{ id: 995, quantity: 1, name: "Coins" }] })], "bank.json"),
      new File([JSON.stringify({ quests: [{ id: 0, name: "Animal Magnetism", state: "FINISHED" }] })], "quests.json"),
      new File([JSON.stringify({ nope: true })], "garbage.json"),
    ];
    const r = await readCharacterExportFiles(files);
    expect(r.player?.source).toBe("character-export");
    expect(r.containers).toHaveLength(1);
    expect(r.questState?.finishedKeys).toContain("animal magnetism");
    expect(r.unrecognized).toEqual(["garbage.json"]);
  });

  it("detects Quest Pathfinder character exports and full backups alongside export files", async () => {
    const files = [
      new File(
        [JSON.stringify({
          app: "quest-pathfinder", kind: "character", version: 3,
          data: { name: "Wren", player: null, completed: [], questPoints: 0, added: [], targets: ["cooks assistant"], savedAt: "2026-11-13T00:00:00Z" },
        })],
        "quest-pathfinder-character-wren.json",
      ),
      new File(
        [JSON.stringify({
          app: "quest-pathfinder", version: 3,
          data: { completed: ["cooks assistant"], targets: [], allowBoosts: true, includeQuestXp: true },
        })],
        "quest-pathfinder-backup-2026-11-13.json",
      ),
      new File(
        [JSON.stringify({ account_name: "Wren", stats: { Attack: { real_level: 70 } } })],
        "character.json",
      ),
    ];
    const r = await readCharacterExportFiles(files);
    expect(r.backups).toHaveLength(2);
    expect(r.backups[0].kind).toBe("character");
    expect((r.backups[0].root.data as { name: string }).name).toBe("Wren");
    expect(r.backups[1].kind).toBe("backup");
    // export files still route normally in the same pick
    expect(r.player?.source).toBe("character-export");
    expect(r.unrecognized).toEqual([]);
  });

  it("rejects app-marker files without a data object", async () => {
    const files = [new File([JSON.stringify({ app: "quest-pathfinder", oops: true })], "broken.json")];
    const r = await readCharacterExportFiles(files);
    expect(r.backups).toEqual([]);
    expect(r.unrecognized).toEqual(["broken.json"]);
  });
});
