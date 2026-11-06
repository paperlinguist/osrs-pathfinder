import { describe, it, expect } from "vitest";
import { suggestUpgrades } from "./upgrade-advisor";
import { ownedKey, type OwnedEntry } from "./character-export";
import { QUESTS, type PlayerSkills } from "./quest-data";

/** a maxed character so no item is level/quest-locked */
const maxed: PlayerSkills = {
  levels: {
    Attack: 99, Defence: 99, Strength: 99, Hitpoints: 99, Ranged: 99, Prayer: 99,
    Magic: 99, Cooking: 99, Woodcutting: 99, Fletching: 99, Fishing: 99,
    Firemaking: 99, Crafting: 99, Smithing: 99, Mining: 99, Herblore: 99,
    Agility: 99, Thieving: 99, Slayer: 99, Farming: 99, Runecraft: 99,
    Hunter: 99, Construction: 99, Sailing: 99,
  },
  xp: {},
  source: "manual",
};
const allQuests = new Set(QUESTS.map((q) => q.key));

function entry(name: string): OwnedEntry {
  return { quantity: 1, sources: ["bank"] };
}

describe("suggestUpgrades", () => {
  it("classifies affordable vs over-budget vs untradeable, and skips owned", () => {
    const owned = new Map<string, OwnedEntry>([[ownedKey("Amulet of glory"), entry("Amulet of glory")]]);
    const r = suggestUpgrades({ player: maxed, completed: allQuests, ownedIndex: owned, coins: 1_000_000 });

    const names = (arr: { item: { name: string } }[]) => arr.map((s) => s.item.name);

    // cheap, buyable, not owned → buy now
    expect(names(r.buyNow)).toContain("Rune crossbow");
    // expensive → save up
    expect(names(r.saveUp)).toContain("Armadyl crossbow");
    // untradeable → earn
    expect(names(r.earn)).toContain("Fire cape");
    // owned already → never suggested
    expect([...names(r.buyNow), ...names(r.saveUp), ...names(r.earn), ...names(r.locked)]).not.toContain("Amulet of glory");
  });

  it("routes quest/level-locked items into the locked bucket", () => {
    const lowMagic: PlayerSkills = { ...maxed, levels: { ...maxed.levels, Magic: 40 } };
    const r = suggestUpgrades({
      player: lowMagic,
      completed: new Set(), // nothing done → occult quest not the issue, but levels are
      ownedIndex: new Map(),
      coins: 999_999_999,
    });
    // Trident of the Seas needs 75 Magic → locked (its gear.json name is
    // capitalised, so match by normalized name)
    const trident = r.locked.find((s) => s.item.name.toLowerCase() === "trident of the seas");
    expect(trident).toBeTruthy();
  });

  it("computes a buy-now total", () => {
    const r = suggestUpgrades({ player: maxed, completed: allQuests, ownedIndex: new Map(), coins: 999_999_999 });
    expect(r.buyNowTotal).toBeGreaterThan(0);
  });
});
