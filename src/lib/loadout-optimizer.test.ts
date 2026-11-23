import { describe, it, expect } from "vitest";
import { optimizeLoadout } from "./loadout-optimizer";
import { BOSS_BY_KEY } from "./boss-data";
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

function entry(): OwnedEntry {
  return { quantity: 1, sources: ["bank"] };
}

function opt(
  bossKey: string,
  presetName: string,
  opts: { owned?: string[]; coins?: number | null; player?: PlayerSkills; completed?: Set<string> } = {},
) {
  const boss = BOSS_BY_KEY[bossKey];
  const preset = boss.presets.find((p) => p.name === presetName);
  if (!preset) throw new Error(`no preset ${bossKey}/${presetName}`);
  return optimizeLoadout(boss, preset, {
    player: opts.player ?? maxed,
    completed: opts.completed ?? allQuests,
    ownedIndex: new Map((opts.owned ?? []).map((n) => [ownedKey(n), entry()])),
    coins: opts.coins ?? null,
  });
}

describe("optimizeLoadout", () => {
  it("buys the pool's best per slot within a big budget", () => {
    const r = opt("fight-caves", "Budget", { coins: 999_999_999 });
    expect(r).not.toBeNull();
    const bySlot = new Map(r!.upgrades.map((u) => [u.slotKey, u]));

    // rune crossbow → Armadyl crossbow is the pool's best ranged weapon
    expect(bySlot.get("weapon")).toMatchObject({ fromName: "Rune crossbow", source: "buy" });
    expect(bySlot.get("weapon")!.toItem.name).toBe("Armadyl crossbow");
    expect(bySlot.get("neck")!.toItem.name).toBe("Necklace of anguish");
    expect(bySlot.get("feet")!.toItem.name).toBe("Pegasian boots");
    // ammo may upgrade within the crossbow's bolt family (ruby/diamond tie —
    // the cheaper dragon bolts win the deterministic tie-break)
    expect(bySlot.get("ammo")!.toItem.name).toContain("dragon bolts (e)");
    // Barrows gloves are untradeable and not owned → never a buy suggestion
    expect(bySlot.has("hands")).toBe(false);

    expect(r!.totalCost).toBeGreaterThan(0);
    expect(r!.totalCost).toBeLessThanOrEqual(999_999_999);
    expect(r!.withinBudget).toBe(true);
    // display order follows SLOT_KEYS
    const order = ["head", "cape", "neck", "ammo", "weapon", "shield", "body", "hands", "legs", "feet", "ring"];
    const idx = r!.upgrades.map((u) => order.indexOf(u.slotKey));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("falls back to an owned upgrade when the better buy is out of reach", () => {
    // owns Karil's coif but has no coins: head should take the free coif,
    // not skip the slot because the Armadyl helmet is unaffordable
    const r = opt("fight-caves", "Budget", { owned: ["Karil's coif"], coins: 0 });
    const head = r!.upgrades.find((u) => u.slotKey === "head");
    expect(head).toMatchObject({ toItem: { name: "Karil's coif" }, source: "owned", price: null });
    expect(r!.upgrades.every((u) => u.source !== "buy")).toBe(true);
    expect(r!.totalCost).toBe(0);
  });

  it("prefers the stronger buy over a weaker owned item when affordable", () => {
    const r = opt("fight-caves", "Budget", { owned: ["Karil's coif"], coins: 999_999_999 });
    const head = r!.upgrades.find((u) => u.slotKey === "head");
    expect(head).toMatchObject({ toItem: { name: "Armadyl helmet" }, source: "buy" });
  });

  it("suggests untradeable upgrades only when owned", () => {
    const bare = opt("fight-caves", "Budget", { coins: 999_999_999 });
    expect(bare!.upgrades.some((u) => u.slotKey === "cape")).toBe(false);

    const owned = opt("fight-caves", "Budget", { owned: ["Ava's assembler"], coins: 999_999_999 });
    expect(owned!.upgrades.find((u) => u.slotKey === "cape")).toMatchObject({
      fromName: "Ava's accumulator",
      toItem: { name: "Ava's assembler" },
      source: "owned",
    });
  });

  it("never spends past the budget", () => {
    // 100k can't buy any crossbow (dragon crossbow is 424.5k)
    const r = opt("fight-caves", "Budget", { coins: 100_000 });
    for (const u of r?.upgrades ?? []) {
      if (u.source === "buy") expect(u.price).toBeLessThanOrEqual(100_000);
    }
    expect(r!.totalCost).toBeLessThanOrEqual(100_000);
    expect(r!.upgrades.some((u) => u.slotKey === "weapon")).toBe(false);
    // the best crossbow is named as the blocker (maxed char → not level-locked)
    const weaponMiss = r!.nearMisses.find((m) => m.slotKey === "weapon");
    expect(weaponMiss).toMatchObject({ item: { name: "Armadyl crossbow" }, reason: "over-budget" });
  });

  it("walks down to the mid-tier when the pool's best is out of reach", () => {
    // 500k can't afford the Armadyl crossbow but lands the Dragon crossbow
    const r = opt("fight-caves", "Budget", { coins: 500_000 });
    const weapon = r!.upgrades.find((u) => u.slotKey === "weapon");
    expect(weapon).toMatchObject({ toItem: { name: "Dragon crossbow" }, source: "buy" });
    // and a dragon crossbow unlocks dragon bolts for the ammo slot
    expect(r!.upgrades.find((u) => u.slotKey === "ammo")!.toItem.name).toContain("dragon bolts (e)");
  });

  it("never suggests ammo the (un-upgraded) weapon can't fire", () => {
    // weapon stays a rune crossbow (both better crossbows over 100k) — dragon
    // bolts only fire from dragon-tier crossbows, so the ammo upgrade must
    // stay on normal bolts (wiki: Dragon bolts firing requirement)
    const r = opt("fight-caves", "Budget", { coins: 100_000 });
    const ammo = r!.upgrades.find((u) => u.slotKey === "ammo");
    expect(ammo!.toItem.name).toBe("Ruby bolts (e)");
  });

  it("counts armour ties with better defence as comfort upgrades", () => {
    // Karil's leathertop ties black d'hide body on offence (30) but tanks
    // better — the old strictly-higher rule hid it entirely
    const r = opt("fight-caves", "Budget", { coins: 5_000_000 });
    const body = r!.upgrades.find((u) => u.slotKey === "body");
    expect(body).toMatchObject({
      toItem: { name: "Karil's leathertop" },
      gain: 0,
      source: "buy",
    });
    expect(body!.defGain).toBeGreaterThan(0);
    expect(r!.upgrades.find((u) => u.slotKey === "legs")!.toItem.name).toBe("Karil's leatherskirt");
    // jewellery is not a tank slot: fury ties glory for ranged and stays put
    expect(r!.upgrades.some((u) => u.slotKey === "neck")).toBe(false);
  });

  it("explains empty slots with the closest blocked option", () => {
    // mid-level character: Karil's/Armadyl are 70-gated, ranger boots are 31.8m
    const mid: PlayerSkills = {
      ...maxed,
      levels: { ...maxed.levels, Ranged: 65, Defence: 60 },
    };
    const r = opt("fight-caves", "Budget", { coins: 1_500_000, player: mid });
    // crossbow: dragon crossbow needs 64 Ranged → affordable, taken
    expect(r!.upgrades.find((u) => u.slotKey === "weapon")!.toItem.name).toBe("Dragon crossbow");
    const bodyMiss = r!.nearMisses.find((m) => m.slotKey === "body");
    expect(bodyMiss!.reason).toBe("locked");
    expect(
      bodyMiss!.locks
        .filter((l): l is Extract<typeof l, { type: "level" }> => l.type === "level")
        .map((l) => `${l.skill} ${l.required}`)
        .sort(),
    ).toEqual(["Defence 70", "Ranged 70"]);
    const feetMiss = r!.nearMisses.find((m) => m.slotKey === "feet");
    expect(feetMiss).toMatchObject({ item: { name: "Pegasian boots" }, reason: "locked" });
    // for a maxed character the same slot is blocked by money, not levels
    const richMiss = opt("fight-caves", "Budget", { coins: 1_500_000 })!.nearMisses.find(
      (m) => m.slotKey === "feet",
    );
    expect(richMiss).toMatchObject({ reason: "over-budget" });
    // untradeable near-misses show when the item isn't owned
    const capeMiss = opt("fight-caves", "Budget", { coins: 999_999_999 })!.nearMisses.find(
      (m) => m.slotKey === "cape",
    );
    expect(capeMiss).toMatchObject({ item: { name: "Ava's assembler" }, reason: "untradeable" });
  });

  it("leaves mechanic gear untouched even when better-on-paper gear is available", () => {
    // dragonfire shield at KBD survives an owned Dragon defender (the whole
    // loadout is pool-best for a maxed character → null is fine here too)
    const kbd = opt("king-black-dragon", "Melee", { owned: ["Dragon defender"], coins: 999_999_999 });
    expect(kbd?.upgrades.some((u) => u.slotKey === "shield") ?? false).toBe(false);

    // dragon hunter crossbow at Vorkath survives an affordable ACB
    const vorkath = opt("vorkath", "Ranged", { coins: 999_999_999 });
    expect(vorkath!.upgrades.some((u) => u.slotKey === "weapon")).toBe(false);

    // Corp's spear mechanic: an owned whip does not displace the Zamorakian
    // spear (rest of the loadout is pool-best → null is fine)
    const corp = opt("corporeal-beast", "Melee (spear)", { owned: ["Abyssal whip"], coins: 999_999_999 });
    expect(corp?.upgrades.some((u) => u.slotKey === "weapon") ?? false).toBe(false);

    // Scurrius bone-weapon bonus: same
    const scurrius = opt("scurrius", "Melee", { owned: ["Abyssal whip"], coins: 999_999_999 });
    expect(scurrius!.upgrades.some((u) => u.slotKey === "weapon")).toBe(false);

    // obsidian set bonus (armour +10% dmg/acc with the weapon, wiki-verified):
    // the whip doesn't displace the Toktz-xil-ak, and Bandos pieces don't
    // break up the armour set around it
    const mole = opt("giant-mole", "Budget", {
      owned: ["Amulet of fury", "Abyssal whip", "Bandos chestplate"],
      coins: 999_999_999,
    });
    expect(mole?.upgrades.some((u) => u.slotKey === "neck") ?? false).toBe(false);
    expect(mole?.upgrades.some((u) => u.slotKey === "weapon") ?? false).toBe(false);
    expect(mole?.upgrades.some((u) => u.slotKey === "body") ?? false).toBe(false);

    // …but obsidian armour without an obsidian weapon is just budget armour —
    // Chaos Elemental pairs it with a whip, so Bandos may upgrade it there
    const ce = opt("chaos-elemental", "Melee", { coins: 999_999_999 });
    expect(ce?.upgrades.some((u) => u.slotKey === "body") ?? false).toBe(true);

    // ring of dueling is teleport utility, not a stat ring
    const barrows = opt("barrows", "Budget", { owned: ["Seers ring"], coins: 999_999_999 });
    expect(barrows!.upgrades.some((u) => u.slotKey === "ring")).toBe(false);
  });

  it("never displaces an off-hand with a two-handed weapon", () => {
    // bludgeon outscores the whip, but the Dragon defender occupies the
    // shield slot (everything else is pool-best → null is fine)
    const r = opt("sarachnis", "Melee", { owned: ["Abyssal bludgeon"], coins: 999_999_999 });
    expect(r?.upgrades.some((u) => u.slotKey === "weapon") ?? false).toBe(false);
  });

  it("keeps F2P presets members-free", () => {
    const r = opt("obor", "F2P melee", { coins: 999_999_999 });
    expect(r!.upgrades.length).toBeGreaterThan(0); // something to upgrade…
    expect(r!.upgrades.every((u) => !u.toItem.members)).toBe(true); // …but only F2P gear
    // the members dragon crossbow never leaks in
    expect(r!.upgrades.some((u) => u.toItem.name === "Dragon crossbow")).toBe(false);
    // amulet of strength → power is the one legal F2P neck upgrade in the pool
    expect(r!.upgrades.find((u) => u.slotKey === "neck")!.toItem.name).toBe("Amulet of power");
  });

  it("allows members gear in a members preset of an F2P boss", () => {
    // the whole obsidian set is synergy-locked so nothing upgrades here,
    // but the members filter must not hide members items from this preset:
    // the cape near-miss is the members-only Fire cape
    const r = opt("obor", "Members melee", { coins: 999_999_999 });
    const capeMiss = r?.nearMisses.find((m) => m.slotKey === "cape");
    expect(capeMiss).toMatchObject({ item: { name: "Fire cape" }, reason: "untradeable" });
    expect(capeMiss!.item.members).toBe(true);
  });

  it("only upgrades ammo inside the weapon's family", () => {
    // maple shortbow fires arrows — bolts are off the table regardless of
    // budget (the F2P pool offers no upgrades at all here → null is fine)
    const bow = opt("bryophyta", "F2P ranged", { coins: 999_999_999 });
    expect(bow?.upgrades.some((u) => u.slotKey === "ammo") ?? false).toBe(false);
  });

  it("scores each preset by its own style, not the boss's first", () => {
    // Zulrah is Magic/Ranged; the Ranged preset must never gain magic gear
    // even though the boss's first style is Magic
    const r = opt("zulrah", "Ranged", { coins: 999_999_999 });
    for (const u of r?.upgrades ?? []) {
      // ranged picks may carry magic penalties, never magic bonuses
      expect(u.toItem.stats.magicAttack).toBeLessThanOrEqual(0);
      expect(u.toItem.stats.magicDamage).toBe(0);
    }
    // and the armour slots really do upgrade (Karil's → Armadyl)
    expect(r!.upgrades.find((u) => u.slotKey === "body")!.toItem.name).toBe("Armadyl chestplate");
  });

  it("never swaps a weapon into one that can't fire the preset's ammo", () => {
    // the style score can't see the blowpipe's attack speed, so a rune
    // crossbow "outscores" it — but darts don't fire from crossbows
    const r = opt("zulrah", "Ranged", { owned: ["Rune crossbow"], coins: 999_999_999 });
    expect(r?.upgrades.some((u) => u.slotKey === "weapon") ?? false).toBe(false);
  });

  it("respects equip locks on candidates", () => {
    // 61 Ranged wields the rune crossbow but not the 70-Ranged Armadyl crossbow
    const lowRanged: PlayerSkills = {
      ...maxed,
      levels: { ...maxed.levels, Ranged: 61, Hitpoints: 75, Defence: 75 },
    };
    const r = opt("fight-caves", "Budget", { coins: 999_999_999, player: lowRanged });
    expect(r!.upgrades.some((u) => u.slotKey === "weapon")).toBe(false);
    // locked armour is skipped too (Armadyl/Karil's need 70 Ranged + Defence)
    expect(r!.upgrades.some((u) => u.slotKey === "body")).toBe(false);
  });

  it("fills the no-raids BiS ladder above the curated tiers", () => {
    // melee: fury → torture, dragon boots → primordial (rich, Sarachnis)
    const r = opt("sarachnis", "Melee", { coins: 999_999_999 });
    expect(r!.upgrades.find((u) => u.slotKey === "neck")!.toItem.name).toBe("Amulet of torture");
    expect(r!.upgrades.find((u) => u.slotKey === "feet")!.toItem.name).toBe("Primordial boots");
    // magic: barrows gloves → tormented, mystic boots → eternal (rich, Kraken)
    const k = opt("kraken", "Magic", { coins: 999_999_999 });
    expect(k!.upgrades.find((u) => u.slotKey === "hands")!.toItem.name).toBe("Tormented bracelet");
    expect(k!.upgrades.find((u) => u.slotKey === "feet")!.toItem.name).toBe("Eternal boots");
    // untradeable BiS never appears unowned, no matter the budget…
    expect(
      [...r!.upgrades, ...k!.upgrades].some((u) => u.toItem.name === "Trident of the Swamp"),
    ).toBe(false);
    expect(
      [...r!.upgrades, ...k!.upgrades].some((u) => u.toItem.name === "Ferocious gloves"),
    ).toBe(false);
    // …but wins its slot the moment you own it
    const owned = opt("kraken", "Magic", { owned: ["Trident of the Swamp"], coins: 0 });
    expect(owned!.upgrades.find((u) => u.slotKey === "weapon")!.toItem.name).toBe("Trident of the Swamp");
    const m = opt("sarachnis", "Melee", { owned: ["Ferocious gloves"], coins: 999_999_999 });
    expect(m!.upgrades.find((u) => u.slotKey === "hands")!.toItem.name).toBe("Ferocious gloves");
  });

  it("flags near-misses you already own — banked, not buyable", () => {
    const mid: PlayerSkills = {
      ...maxed,
      levels: { ...maxed.levels, Hitpoints: 70, Ranged: 65, Defence: 60 },
    };
    const r = opt("fight-caves", "Budget", {
      owned: ["Ava's assembler"],
      coins: 1_500_000,
      player: mid,
    });
    const capeMiss = r!.nearMisses.find((m) => m.slotKey === "cape");
    expect(capeMiss).toMatchObject({ item: { name: "Ava's assembler" }, reason: "locked", owned: true });
    // the neck near-miss (anguish at 70 Hitpoints) is not banked
    expect(r!.nearMisses.find((m) => m.slotKey === "neck")!.owned).toBe(false);
  });

  it("returns null without an items import and for note-only presets", () => {
    const boss = BOSS_BY_KEY["fight-caves"];
    const preset = boss.presets[0];
    expect(optimizeLoadout(boss, preset, { player: maxed, completed: allQuests, ownedIndex: null, coins: 0 })).toBeNull();
    expect(opt("gauntlet", "Crafted in-raid", { coins: 999_999_999 })).toBeNull();
  });
});
