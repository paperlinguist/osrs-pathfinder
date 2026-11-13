/**
 * Build src/data/diaries.json — the Achievement Diary dataset for the quest
 * planner's diary tracking.
 *
 * Each of the 12 diary areas has a wiki page whose "Overview" section holds a
 * tab per tier (Easy/Medium/Hard/Elite) with:
 *   - a {{DiarySkillStats}} template: one param per skill level, plus
 *     boostable=false for tiers whose skill reqs cannot be boosted,
 *     `Quest = N` (a quest-points gate) and `Combat = N` (combat-level gate)
 *   - a "Quest requirements" table (one completed quest per row)
 *   - an "Additional requirements" table (favour, partial completions, …)
 *     → kept as a human-readable `notes` string
 *
 * Wiki quest names are mapped onto src/data/quests.json keys (by name; the
 * WIKI_NAME_OVERRIDES table below covers renames/subpages). Anything that
 * fails to map fails the build loudly — same contract as build-gear.ts.
 *
 * Inputs: the OSRS Wiki API (action=parse, prop=wikitext). Fetched pages are
 * cached in .data-cache/diaries-wiki/ (gitignored) so regeneration is offline.
 *
 * Run: node tools/build-diaries.ts
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, ".data-cache", "diaries-wiki");
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf8"));

const API =
  "https://oldschool.runescape.wiki/api.php?action=parse&redirects=1&prop=wikitext&format=json&formatversion=2&page=";

/** the 12 diary areas and their wiki pages, in osrs-db enum spelling */
const AREAS: { area: string; page: string; enumArea: string }[] = [
  { area: "Ardougne", page: "Ardougne Diary", enumArea: "ARDOUGNE" },
  { area: "Desert", page: "Desert Diary", enumArea: "DESERT" },
  { area: "Falador", page: "Falador Diary", enumArea: "FALADOR" },
  { area: "Fremennik", page: "Fremennik Diary", enumArea: "FREMENNIK" },
  { area: "Kandarin", page: "Kandarin Diary", enumArea: "KANDARIN" },
  { area: "Karamja", page: "Karamja Diary", enumArea: "KARAMJA" },
  { area: "Kourend & Kebos", page: "Kourend & Kebos Diary", enumArea: "KOUREND_AND_KEBOS" },
  { area: "Lumbridge & Draynor", page: "Lumbridge & Draynor Diary", enumArea: "LUMBRIDGE_AND_DRAYNOR" },
  { area: "Morytania", page: "Morytania Diary", enumArea: "MORYTANIA" },
  { area: "Varrock", page: "Varrock Diary", enumArea: "VARROCK" },
  { area: "Western Provinces", page: "Western Provinces Diary", enumArea: "WESTERN_PROVINCES" },
  { area: "Wilderness", page: "Wilderness Diary", enumArea: "WILDERNESS" },
];

const TIERS = ["Easy", "Medium", "Hard", "Elite"] as const;
type Tier = (typeof TIERS)[number];

/** wiki quest link text → quests.json key, for names that don't match verbatim */
const WIKI_NAME_OVERRIDES: Record<string, string> = {
  "Skippy and the Mogres": "skippy and mogres",
  "Alfred Grimhand's Barcrawl": "alfred grimhands barcrawl",
  "Enter the Abyss": "enter abyss",
};

/** params of {{DiarySkillStats}} that are not skill levels */
const META_PARAMS = new Set(["margin", "maxrefs", "selectable", "boostable", "total"]);

/* ------------------------------------------------------------------ fetch */

async function fetchWikitext(page: string): Promise<string> {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, page.replace(/[^\w]+/g, "_") + ".json");
  if (fs.existsSync(file)) return readJson(file).wikitext as string;
  const res = await fetch(API + encodeURIComponent(page), {
    headers: { "User-Agent": "osrs-pathfinder data pipeline (github.com/paperlinguist/osrs-pathfinder)" },
  });
  if (!res.ok) throw new Error(`wiki fetch failed for ${page}: HTTP ${res.status}`);
  const json: any = await res.json();
  if (json.error || !json.parse?.wikitext)
    throw new Error(`wiki parse failed for ${page}: ${json.error?.info ?? "no wikitext"}`);
  fs.writeFileSync(file, JSON.stringify(json.parse, null, 1));
  return json.parse.wikitext as string;
}

/* ------------------------------------------------------------------ parse */

/** extract a template block with balanced {{…}} nesting (Notes params embed
 *  further templates like {{boostable|no}} — a lazy regex stops at those) */
function templateBody(wikitext: string, name: string): string | null {
  const start = wikitext.indexOf(`{{${name}`);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") { depth++; i++; }
    else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) return wikitext.slice(start + 2 + name.length, i - 1);
    }
  }
  return null;
}

/** strip wiki markup from a table-cell/notes fragment */
function plainText(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1") // [[page|label]] → label
    .replace(/\[\[([^\]]*)\]\]/g, "$1") // [[page]] → page
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/'''?/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface TierData {
  skills: Record<string, { level: number; boostable: boolean; requiredToStart: boolean }>;
  qp: number | null;
  quests: string[]; // wiki names, pre-mapping
  allQuests: boolean; // a task requires EVERY quest complete (Lumbridge Elite)
  notes: string | null;
}

function parseTier(wikitext: string, area: string, tier: Tier): TierData {
  // slice this tier's tab: from `|-|Tier=` (whitespace-tolerant — some pages
  // break the marker across lines) up to the next tier marker (or EOF)
  const marker = (t: string) => new RegExp(`\\|-\\|\\s*${t}\\s*=`);
  const start = wikitext.search(marker(tier));
  if (start < 0) throw new Error(`${area}: no tabber marker |-|${tier}=`);
  const nexts = TIERS.filter((t) => t !== tier)
    .flatMap((t) => {
      const m = marker(t).exec(wikitext.slice(start + 1));
      return m ? [start + 1 + m.index] : [];
    })
    .filter((i) => i > start);
  const slice = wikitext.slice(start, nexts.length ? Math.min(...nexts) : undefined);

  // --- DiarySkillStats template (first one in the tab)
  const body = templateBody(slice, "DiarySkillStats");
  if (body == null) throw new Error(`${area} ${tier}: no {{DiarySkillStats}} template`);
  const skills: TierData["skills"] = {};
  let qp: number | null = null;
  let boostable = true; // wiki default: "temporary skill boosts can be used"
  for (const param of body.split("\n")) {
    const pm = param.match(/^\|\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (!pm) continue;
    const [name, value] = [pm[1], pm[2]];
    if (name === "boostable") {
      boostable = value.trim().toLowerCase() !== "false";
      continue;
    }
    if (META_PARAMS.has(name.toLowerCase()) || name.endsWith("Notes")) continue;
    if (name === "Quest" && /\{\{Globals\|/.test(value)) continue; // "every QP" — covered by allQuests
    const level = Number(value);
    if (!Number.isFinite(level)) throw new Error(`${area} ${tier}: non-numeric ${name} = ${value}`);
    if (name === "Quest") {
      qp = level;
    } else {
      skills[name] = { level, boostable, requiredToStart: false };
    }
  }

  // --- quest requirements table (first one in the tab)
  const quests: string[] = [];
  let allQuests = false;
  const qm = slice.match(/!\s*Quest requirements([\s\S]*?)\n\|\}/);
  if (qm) {
    for (const row of qm[1].split("\n")) {
      // a content cell — not `|- attrs`, `!` header or `|}` terminator lines
      const cell = row.match(/^\|(?![\-}+])([^|].*)$/);
      if (!cell) continue;
      const link = cell[1].match(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/);
      const text = link ? link[1] : plainText(cell[1]);
      if (!text) continue;
      // "[[Quests/List|All quests]]" — one task needs every quest complete
      if (text === "Quests/List" || plainText(cell[1]).toLowerCase() === "all quests") {
        allQuests = true;
        continue;
      }
      quests.push(text);
    }
  }

  // --- additional requirements table → notes
  const am = slice.match(/!\s*Additional requirements([\s\S]*?)\n\|\}/);
  const notes: string[] = [];
  if (am) {
    for (const row of am[1].split("\n")) {
      const cell = row.match(/^\|(?![\-}+])([^|].*)$/);
      if (!cell) continue;
      const text = plainText(cell[1]);
      if (text && text.toLowerCase() !== "none") notes.push(text);
    }
  }

  return { skills, qp, quests, allQuests, notes: notes.length ? notes.join(" · ") : null };
}

/* ------------------------------------------------------------------ build */

const questsJson = readJson(path.join(ROOT, "src/data/quests.json"));
const QUEST_BY_NAME = new Map<string, string>(
  questsJson.quests.flatMap((q: any) => [
    [q.name.toLowerCase(), q.key],
    [q.key, q.key],
  ]),
);

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const diaries: any[] = [];
const problems: string[] = [];

for (const { area, page, enumArea } of AREAS) {
  const wikitext = await fetchWikitext(page);
  for (const tier of TIERS) {
    const t = parseTier(wikitext, area, tier);
    const questKeys = t.quests.map((name) => {
      const key = QUEST_BY_NAME.get(name.toLowerCase()) ?? WIKI_NAME_OVERRIDES[name];
      if (!key) problems.push(`${area} ${tier}: unknown quest "${name}"`);
      return key ?? name;
    });
    diaries.push({
      key: `${slug(area)} ${tier.toLowerCase()}`,
      name: `${area} ${tier}`,
      area,
      tier,
      enum: `${enumArea}_${tier.toUpperCase()}`,
      wikiName: page,
      members: true,
      qp: t.qp,
      skills: t.skills,
      quests: [...new Set(questKeys)].sort(),
      ...(t.allQuests ? { allQuests: true } : {}),
      notes: t.notes,
    });
  }
}

if (problems.length) {
  console.error("UNRESOLVED QUEST NAMES (fix via WIKI_NAME_OVERRIDES or quests.json):");
  for (const p of [...new Set(problems)]) console.error("  " + p);
  process.exit(1);
}

diaries.sort((a, b) => a.area.localeCompare(b.area) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));

fs.writeFileSync(
  path.join(ROOT, "src/data/diaries.json"),
  JSON.stringify(
    {
      meta: {
        sources: [
          "oldschool.runescape.wiki <Area> Diary pages (DiarySkillStats + quest tables)",
          "tier chain: wiki states previous tiers must be completed to claim a tier's reward",
        ],
        generated: new Date().toISOString().slice(0, 10),
      },
      diaries,
    },
    null,
    1,
  ) + "\n",
);

/* -------------------------------------------------------- verification dump */

console.log(`${diaries.length} diary tiers written to src/data/diaries.json\n`);
for (const d of diaries) {
  const skills = Object.entries(d.skills)
    .map(([s, r]: [string, any]) => `${s} ${r.level}${r.boostable ? "" : "*"}`)
    .join(", ");
  console.log(`${d.name.padEnd(24)} QP ${String(d.qp ?? "-").padStart(3)} | ${skills}`);
  if (d.quests.length) console.log(`${"".padEnd(26)} quests: ${d.quests.map((k: string) => questsJson.quests.find((q: any) => q.key === k).name).join(", ")}`);
  if (d.allQuests) console.log(`${"".padEnd(26)} quests: ALL (one task needs every quest complete)`);
  if (d.notes) console.log(`${"".padEnd(26)} notes: ${d.notes}`);
}
console.log("\n* = unboostable tier (boostable=false in DiarySkillStats)");
