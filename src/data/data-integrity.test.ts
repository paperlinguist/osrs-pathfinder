import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import bossesJson from "@/data/bosses.json";
import gearJson from "@/data/gear.json";
import diariesJson from "@/data/diaries.json";
import {
  DIARIES,
  DIARY_BY_KEY,
  QUESTS,
  SKILL_NAMES,
  TARGET_BY_KEY,
  isValidTargetKey,
} from "@/lib/quest-data";
import { ownedKey } from "@/lib/character-export";

/**
 * Data-integrity regressions — the automated version of the manual audit that
 * has caught every data bug so far (bad quest keys, members-only items in F2P
 * presets, poisoned-variant resolution, unresolved preset items). Every new
 * boss or gear item must pass these.
 */

const bosses = (bossesJson as unknown as { bosses: any[] }).bosses;
const gear = (gearJson as unknown as { items: any[] }).items;

const questKeys = new Set<string>(QUESTS.map((q) => q.key));
const skillNames = new Set<string>(SKILL_NAMES);
const gearByKey = new Map<string, any>(gear.map((g) => [ownedKey(g.name), g]));

describe("bosses.json integrity", () => {
  it("boss keys are unique", () => {
    const keys = bosses.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every requirement quest key resolves to a real quest", () => {
    const bad: string[] = [];
    for (const b of bosses) {
      for (const q of b.requirements?.quests ?? []) {
        if (!questKeys.has(q)) bad.push(`${b.key}: ${q}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every requirement/recommended skill is a real skill name", () => {
    const bad: string[] = [];
    for (const b of bosses) {
      for (const r of [...(b.requirements?.skills ?? []), ...(b.recommended ?? [])]) {
        if (!skillNames.has(r.skill)) bad.push(`${b.key}: ${r.skill}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every preset slot item resolves to gear data", () => {
    const bad: string[] = [];
    for (const b of bosses) {
      for (const p of b.presets ?? []) {
        for (const [slot, name] of Object.entries(p.slots ?? {})) {
          if (typeof name === "string" && !gearByKey.has(ownedKey(name))) {
            bad.push(`${b.key}/${p.name}/${slot}: ${name}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("F2P presets contain no members-only items", () => {
    const bad: string[] = [];
    for (const b of bosses) {
      if (b.members) continue;
      for (const p of b.presets ?? []) {
        if (!p.name.toLowerCase().includes("f2p")) continue;
        for (const name of Object.values(p.slots ?? {})) {
          const item = gearByKey.get(ownedKey(name as string));
          if (item?.members) bad.push(`${b.key}/${p.name}: ${name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("every boss has presets, notes and a tagline", () => {
    const bad: string[] = [];
    for (const b of bosses) {
      if (!(b.presets?.length > 0)) bad.push(`${b.key}: no presets`);
      if (!b.notes) bad.push(`${b.key}: no notes`);
      if (!b.tagline) bad.push(`${b.key}: no tagline`);
    }
    expect(bad).toEqual([]);
  });
});

describe("gear.json integrity", () => {
  it("gear item names are unique after normalization", () => {
    const keys = gear.map((g) => ownedKey(g.name));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every gear item's quest requirements resolve", () => {
    const bad: string[] = [];
    for (const g of gear) {
      for (const q of g.reqQuests ?? []) {
        if (!questKeys.has(q)) bad.push(`${g.name}: ${q}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("regression: Adamant arrow resolved to the F2P (unpoisoned) variant", () => {
    const arrow = gearByKey.get("adamant arrow");
    expect(arrow).toBeTruthy();
    // the poisoned #(p++) variant is members-only; the preset ammo must be F2P
    expect(arrow.members).toBe(false);
  });

  it("every preset item exists in the dataset at most once (no orphan variants)", () => {
    // gear.json should contain only what presets reference plus their stats —
    // a stray duplicate under a different variant would break lookups
    const names = new Set(gear.map((g) => g.name));
    expect(names.size).toBe(gear.length);
  });
});

describe("quests.json integrity", () => {
  it("quest keys are unique", () => {
    const keys = QUESTS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("quest enum names are unique where present", () => {
    const enums = QUESTS.filter((q) => q.enum).map((q) => q.enum);
    expect(new Set(enums).size).toBe(enums.length);
  });
});

describe("diaries.json integrity", () => {
  const TIERS = ["Easy", "Medium", "Hard", "Elite"];
  const questKeys = new Set<string>(QUESTS.map((q) => q.key));

  it("covers every area with all four tiers (12 × 4)", () => {
    expect(DIARIES).toHaveLength(48);
    const byArea = new Map<string, string[]>();
    for (const d of DIARIES) {
      if (!byArea.has(d.area)) byArea.set(d.area, []);
      byArea.get(d.area)!.push(d.tier);
    }
    expect(byArea.size).toBe(12);
    for (const tiers of byArea.values()) expect(tiers.sort()).toEqual([...TIERS].sort());
  });

  it("diary keys are unique and never collide with quest keys", () => {
    const keys = DIARIES.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    const clashes = keys.filter((k) => questKeys.has(k));
    expect(clashes).toEqual([]);
  });

  it("every diary quest prerequisite resolves to a real quest", () => {
    const bad: string[] = [];
    for (const d of DIARIES) {
      for (const q of d.quests) {
        if (!questKeys.has(q)) bad.push(`${d.key}: ${q}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every diary skill is a real skill name or the virtual Combat", () => {
    const bad: string[] = [];
    for (const d of DIARIES) {
      for (const s of Object.keys(d.skills)) {
        if (!skillNames.has(s) && s !== "Combat") bad.push(`${d.key}: ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("tier chains point at the next-lower tier of the same area", () => {
    for (const d of DIARIES) {
      const q = TARGET_BY_KEY[d.key];
      if (d.tier === "Easy") {
        expect(q.diaryPrereq, `${d.key}: Easy must not chain to a lower tier`).toBeUndefined();
      } else {
        const lower = DIARY_BY_KEY[q.diaryPrereq!];
        expect(lower, `${d.key}: missing diaryPrereq`).toBeTruthy();
        expect(lower.area).toBe(d.area);
        expect(TIERS.indexOf(lower.tier)).toBe(TIERS.indexOf(d.tier) - 1);
      }
    }
  });

  it("diaries are valid targets and the all-quests flag survived generation", () => {
    for (const d of DIARIES) expect(isValidTargetKey(d.key)).toBe(true);
    // the Lumbridge & Draynor Elite "complete every quest" task
    expect(DIARY_BY_KEY["lumbridge-and-draynor elite"].allQuests).toBe(true);
    expect(diariesJson.meta.sources.length).toBeGreaterThan(0);
  });
});

describe("README consistency", () => {
  // The README's counts ("215 quests · 41 bosses") must match the datasets —
  // this is the mechanical backstop for the "update the README every release"
  // rule, so a stale count fails CI instead of relying on someone remembering.
  const readme = readFileSync(path.resolve(process.cwd(), "README.md"), "utf8");

  it("quest count matches the dataset", () => {
    const m = readme.match(/(\d+)\s+quests\s*·/);
    expect(m, "README quest count not found").toBeTruthy();
    expect(Number(m![1])).toBe(QUESTS.length);
  });

  it("boss count matches the dataset", () => {
    const m = readme.match(/·\s*(\d+)\s+bosses/);
    expect(m, "README boss count not found").toBeTruthy();
    expect(Number(m![1])).toBe(bosses.length);
  });

  it("diary count matches the dataset", () => {
    const m = readme.match(/(\d+)\s+diaries/);
    expect(m, "README diary count not found").toBeTruthy();
    expect(Number(m![1])).toBe(DIARIES.length);
  });
});
