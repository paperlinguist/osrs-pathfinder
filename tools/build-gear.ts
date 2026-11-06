/**
 * Build src/data/gear.json for the boss gear planner.
 *
 * Reads the curated preset item lists from src/data/bosses.json and enriches
 * every referenced item with stats + equip requirements from the osrs-db
 * dataset, plus a Grand Exchange price snapshot from the official item DB.
 *
 * Inputs (not committed — download once into .data-cache/):
 *   .data-cache/slotStats.g.json        from https://github.com/wvanderp/osrs-db (git-lfs, MIT)
 *   .data-cache/itemRequirements.json   from the same repo
 * Price cache: .data-cache/prices.json (written by this script; fetches are
 * rate-limited and only happen for items missing from the cache).
 *
 * Run: node tools/build-gear.ts
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, ".data-cache");
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));

/* ------------------------------------------------ equip-requirement overrides
 * osrs-db's wear-requirements come from the cache and occasionally miss
 * requirements the wiki documents (or encode a different level). Each
 * override below was verified against the OSRS Wiki page and REPLACES the
 * skill levels from the dataset; the `why` lands in gear.json for audit.
 */
const REQ_OVERRIDES: Record<string, { levels: Record<string, number>; quests?: string[]; why: string }> = {
  "broad bolts": { levels: { Ranged: 61, Slayer: 55 }, why: "wiki: 55 Slayer + 61 Ranged (cache lists only Ranged 65)" },
  "toxic blowpipe": { levels: { Ranged: 75 }, why: "wiki-verified (missing from cache dataset)" },
  "ava's assembler": { levels: { Ranged: 70 }, why: "wiki-verified (missing from cache dataset)" },
  "dragon defender": { levels: { Defence: 60 }, why: "wiki: 60 Defence only (missing from cache dataset)" },
  "necklace of anguish": { levels: { Hitpoints: 75 }, why: "wiki: 75 Hitpoints (missing from cache dataset)" },
  "pegasian boots": { levels: { Ranged: 75, Defence: 75 }, why: "wiki: 75 Ranged + 75 Defence (missing from cache dataset)" },
  "obsidian helmet": { levels: { Defence: 60 }, why: "wiki: obsidian armour requires 60 Defence (cape excepted)" },
  "obsidian platebody": { levels: { Defence: 60 }, why: "wiki: obsidian armour requires 60 Defence (cape excepted)" },
  "obsidian platelegs": { levels: { Defence: 60 }, why: "wiki: obsidian armour requires 60 Defence (cape excepted)" },
  "iban's staff (u)": { levels: { Magic: 50, Attack: 50 }, quests: ["underground pass"], why: "wiki: same wield reqs as base staff; cache has none for the upgraded variant" },
  "ruby dragon bolts (e)": { levels: { Ranged: 64 }, why: "wiki: dragon bolts require 64 Ranged (cache has none)" },
  "diamond dragon bolts (e)": { levels: { Ranged: 64 }, why: "wiki: dragon bolts require 64 Ranged (cache has none)" },
};

/** variant suffix preference when several osrs-db entries share a base name */
const SUFFIX_PREFERENCE = ["unp", "normal", "undamaged", "charged", "regular", "(8)", "4"];

const norm = (s: string): string =>
  s.toLowerCase().replace(/#.*$/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** same normalization as item names, so "ava's assembler" keys match lookups */
const OVERRIDES_NORM = new Map(Object.entries(REQ_OVERRIDES).map(([k, v]) => [norm(k), v]));

interface SlotStat {
  id: number; name: string; members: boolean;
  stabAttack: number; slashAttack: number; crushAttack: number; magicAttack: number;
  rangedAttack: number; stabDefence: number; slashDefence: number; crushDefence: number;
  magicDefence: number; rangedDefence: number; strengthBonus: number; rangedStrength: number;
  magicDamage: number; prayerBonus: number; weight: number; speed: number; slot: string;
}

/* ------------------------------------------------------------------- inputs */

const slotStats: SlotStat[] = readJson(path.join(CACHE, "slotStats.g.json"));
const itemRequirements: { id: number; name: string; requirements: any[] }[] = readJson(
  path.join(CACHE, "itemRequirements.json"),
);
const questsJson = readJson(path.join(ROOT, "src/data/quests.json"));
const bossesJson = readJson(path.join(ROOT, "src/data/bosses.json"));

const QUEST_BY_ENUM = new Map<string, string>(
  questsJson.quests.filter((q: any) => q.enum).map((q: any) => [q.enum, q.key]),
);
const REQS_BY_ID = new Map(itemRequirements.map((r) => [r.id, r]));

/* group slotStats entries by normalized (variant-stripped) name */
const BY_NORM = new Map<string, SlotStat[]>();
for (const s of slotStats) {
  const k = norm(s.name);
  const list = BY_NORM.get(k) ?? [];
  list.push(s);
  BY_NORM.set(k, list);
}

function resolveItem(target: string): SlotStat | null {
  const list = BY_NORM.get(norm(target));
  if (!list || list.length === 0) return null;
  if (list.length === 1) return list[0];
  // variant suffix, parens stripped: "#(unp)" → "unp" (so dart/bolt poison
  // variants match the preference list, not just "#" suffixed ones)
  const suffix = (name: string) =>
    name.includes("#") ? name.split("#")[1].replace(/[()]/g, "").toLowerCase() : "";
  for (const pref of SUFFIX_PREFERENCE) {
    const hit = list.find((s) => suffix(s.name) === pref);
    if (hit) return hit;
  }
  return list[0];
}

/* --------------------------------------------------------------- GE prices */

interface PriceCache { [id: number]: { price: number | null; fetchedAt: string } }
const priceCachePath = path.join(CACHE, "prices.json");
const priceCache: PriceCache = fs.existsSync(priceCachePath) ? readJson(priceCachePath) : {};

/** parse GE price values like `1025`, `"2.3k"`, `"1.2m"`, `"-"` → number|null */
function parseGePrice(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^([\d,.]+)\s*([km])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (/k/i.test(m[2] ?? "")) return Math.round(n * 1_000);
  if (/m/i.test(m[2] ?? "")) return Math.round(n * 1_000_000);
  return Math.round(n);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPrice(id: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://services.runescape.com/m=itemdb_oldschool/api/catalogue/detail.json?item=${id}`,
      { headers: { "User-Agent": "osrs-pathfinder-gear-builder/1.0" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    return parseGePrice(data?.item?.current?.price);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- collection */

// every item name referenced by any preset (insertion order = boss order)
const referenced: string[] = [];
for (const boss of bossesJson.bosses) {
  for (const preset of boss.presets ?? []) {
    for (const item of Object.values(preset.slots ?? {})) {
      if (typeof item === "string" && !referenced.includes(item)) referenced.push(item);
    }
  }
}

const misses: string[] = [];
const items: any[] = [];
let fetched = 0;
const appliedOverrides: string[] = [];

for (const name of referenced) {
  const s = resolveItem(name);
  if (!s) { misses.push(name); continue; }

  // requirements from the dataset
  const reqLevels: Record<string, number> = {};
  const reqQuests: string[] = [];
  const unmappedEnums: string[] = [];
  const req = REQS_BY_ID.get(s.id);
  for (const r of req?.requirements ?? []) {
    if (r?.type === "skill" && typeof r.skill === "string" && typeof r.level === "number") {
      reqLevels[r.skill] = Math.max(reqLevels[r.skill] ?? 0, r.level);
    } else if (r?.type === "quest" && typeof r.quest === "string") {
      const key = QUEST_BY_ENUM.get(r.quest);
      if (key) reqQuests.push(key);
      else unmappedEnums.push(r.quest);
    }
  }

  // wiki-verified overrides replace skill levels entirely (and quests, when given)
  let overrideWhy: string | null = null;
  const ov = OVERRIDES_NORM.get(norm(name));
  if (ov) {
    for (const k of Object.keys(reqLevels)) delete reqLevels[k];
    Object.assign(reqLevels, ov.levels);
    if (ov.quests) reqQuests.splice(0, reqQuests.length, ...ov.quests);
    overrideWhy = ov.why;
    appliedOverrides.push(`${name} (${ov.why})`);
  }

  items.push({
    id: s.id,
    name: s.name.replace(/#.*$/, ""),
    rawName: s.name,
    slot: s.slot,
    members: s.members,
    stats: {
      stabAttack: s.stabAttack, slashAttack: s.slashAttack, crushAttack: s.crushAttack,
      magicAttack: s.magicAttack, rangedAttack: s.rangedAttack,
      stabDefence: s.stabDefence, slashDefence: s.slashDefence, crushDefence: s.crushDefence,
      magicDefence: s.magicDefence, rangedDefence: s.rangedDefence,
      strengthBonus: s.strengthBonus, rangedStrength: s.rangedStrength,
      magicDamage: s.magicDamage, prayerBonus: s.prayerBonus,
    },
    speed: s.speed,
    reqLevels,
    reqQuests,
    override: overrideWhy,
    price: null, // filled below
  });
  if (unmappedEnums.length) console.warn(`  ! ${name}: quest enums not in our data: ${unmappedEnums.join(", ")}`);
}

/* ------------------------------------------------------------------ prices */

for (const it of items) {
  if (priceCache[it.id]) { it.price = priceCache[it.id].price; continue; }
  const price = await fetchPrice(it.id); // null = untradeable (or transient failure)
  priceCache[it.id] = { price, fetchedAt: new Date().toISOString() };
  it.price = price;
  fetched++;
  await sleep(150);
}
fs.writeFileSync(priceCachePath, JSON.stringify(priceCache, null, 1));

/* ------------------------------------------------------------------ output */

const gear = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    sources: [
      "wvanderp/osrs-db (MIT) — slotStats + itemRequirements, via git-lfs (see tools/build-gear.ts header)",
      "OSRS Wiki — requirement overrides marked per-item in `override`",
      "Jagex item DB API — GE price snapshot; price null = untradeable or unfetchable",
    ],
    priceSnapshot: new Date().toISOString(),
    items: items.length,
  },
  items,
};
fs.writeFileSync(path.join(ROOT, "src/data/gear.json"), JSON.stringify(gear, null, 1) + "\n");

console.log(`gear.json: ${items.length} items (${fetched} prices fetched, ${items.length - fetched} cached)`);
if (misses.length) {
  console.error(`MISSING from slotStats (${misses.length}):`);
  for (const m of misses) console.error(`  - ${m}`);
  console.error("Fix the item names in src/data/bosses.json (or add variants to SUFFIX_PREFERENCE).");
  process.exit(1);
}
if (appliedOverrides.length) console.log("overrides applied:\n  " + appliedOverrides.join("\n  "));
