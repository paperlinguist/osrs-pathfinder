import { QUESTS, type Quest } from "@/lib/quest-data";

/**
 * Parser for quest-state JSON files written by RuneLite plugins.
 *
 * Two formats are auto-detected; both use the same entry shape
 * (`{ id, name, state }`, state ∈ FINISHED / IN_PROGRESS / NOT_STARTED) but
 * different `id` types:
 *
 * 1. Character Export (https://runelite.net/plugin-hub/show/character-export)
 *    — the recommended all-in-one exporter (quests, stats, bank, equipment):
 * {
 *   "exported_at": "2026-11-06T12:00:00Z", "plugin_version": "0.6.0",
 *   "summary": { "finished": 31, "in_progress": 4, "not_started": 179 },
 *   "quests": [{ "id": 0,
 *                "name": "Animal Magnetism", "state": "FINISHED" }, ...]
 * }
 *    `id` is the RuneLite quest ordinal — identical to our data's `cacheId`.
 *    The account name lives in the folder (character-exporter/<Account>/),
 *    not in the file, so `rsn` comes back null.
 *
 * 2. Quest State Exporter (https://runelite.net/plugin-hub/show/quest-state-exporter):
 * {
 *   "schemaVersion": "1.0.0", "exportVersion": "1.0.0",
 *   "timestampIso": "2026-10-27T19:52:11.690491800Z", "rsn": "Wren von Arx",
 *   "quests": { "notStarted": 179, "inProgress": 4, "finished": 31,
 *               "unknown": 0, "total": 214, "questPoints": 47,
 *               "entries": [{ "id": "ANIMAL_MAGNETISM",
 *                             "name": "Animal Magnetism", "state": "FINISHED" }, ...] }
 * }
 *    `id` is the RuneLite quest enum name, matching our `enum` field 1:1
 *    (verified against the full 214-quest plugin output).
 */

export interface QuestStateEntry {
  id: string;
  name: string;
  state: string;
}

/** which plugin format a parsed file came from (for UI messaging) */
export type QuestImportSource = "character-export" | "quest-state-exporter";

export interface ParsedQuestState {
  /** character name from the file, if present (Character Export keeps it in the folder name, not the file) */
  rsn: string | null;
  /** ISO timestamp from the file, if present */
  timestampIso: string | null;
  /** quest points reported by the file, if present */
  fileQuestPoints: number | null;
  /** keys of our quests the file says are FINISHED */
  finishedKeys: string[];
  /** keys present in the file but NOT finished (for "sync" mode: these get unset) */
  notFinishedKeys: string[];
  /** how many mapped quests are IN_PROGRESS (reported, left untouched) */
  inProgressCount: number;
  /** plugin entries that don't map to any quest in our data (newest content, miniquests the plugin tracks that we don't, …) */
  unmatched: QuestStateEntry[];
  /** detected source format */
  source: QuestImportSource;
}

// enum-name lookup (Quest State Exporter string ids)
const QUEST_BY_ENUM: ReadonlyMap<string, Quest> = new Map(
  QUESTS.filter((q) => q.enum).map((q) => [q.enum, q]),
);

// numeric-id lookup (Character Export ids are RuneLite quest ordinals == our
// cacheId — verified consistent for classic quests; some miniquest ids in our
// data come from a different registry space, so numeric hits are corroborated
// against the entry name in mapQuestEntry)
const QUEST_BY_CACHE_ID: ReadonlyMap<number, Quest> = new Map(
  QUESTS.filter((q) => typeof q.cacheId === "number").map((q) => [q.cacheId as number, q]),
);

/** normalized name → quest, covering both our `name` and canonical `registryName` */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const QUEST_BY_NAME: ReadonlyMap<string, Quest> = (() => {
  const m = new Map<string, Quest>();
  for (const q of QUESTS) {
    for (const n of [q.name, q.registryName]) {
      if (n) m.set(normName(n), q);
    }
  }
  return m;
})();

const nameOf = (q: Quest): string => normName(q.registryName ?? q.name);

/** map one plugin entry to our quest data, by id (enum string or numeric) then name */
function mapQuestEntry(e: Record<string, unknown>): Quest | null {
  const entryName = typeof e.name === "string" ? e.name.trim() : null;
  const byName = entryName ? (QUEST_BY_NAME.get(normName(entryName)) ?? null) : null;

  if (typeof e.id === "string") {
    return QUEST_BY_ENUM.get(e.id.toUpperCase()) ?? byName;
  }
  if (typeof e.id === "number" && Number.isInteger(e.id)) {
    const q = QUEST_BY_CACHE_ID.get(e.id);
    // numeric hit wins only when the entry's name corroborates it (or there is
    // no name to check) — miniquest cacheIds can collide across id spaces
    if (q && (!entryName || nameOf(q) === normName(entryName))) return q;
  }
  return byName;
}

/**
 * Parse and map a quest-state export from either supported plugin.
 * Returns `null` when the payload doesn't look like a quest-state export at
 * all (wrong shape / empty entries) so the caller can show a clean error.
 */
export function parseQuestStateExport(raw: unknown): ParsedQuestState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // Character Export: `quests` is a top-level array, summary beside it
  // Quest State Exporter: `quests` is an object wrapping an `entries` array
  let entries: unknown[] | null = null;
  let source: QuestImportSource | null = null;
  let qpContainer: Record<string, unknown> | null = null;
  if (Array.isArray(obj.quests)) {
    entries = obj.quests;
    source = "character-export";
  } else if (obj.quests && typeof obj.quests === "object") {
    const q = obj.quests as Record<string, unknown>;
    if (Array.isArray(q.entries)) {
      entries = q.entries;
      source = "quest-state-exporter";
      qpContainer = q;
    }
  }
  if (!entries || !source || entries.length === 0) return null;

  const finishedKeys: string[] = [];
  const notFinishedKeys: string[] = [];
  const unmatched: QuestStateEntry[] = [];
  let inProgressCount = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" && typeof e.id !== "number") continue;
    const quest = mapQuestEntry(e);
    const state = typeof e.state === "string" ? e.state : "";
    if (!quest) {
      unmatched.push({
        id: String(e.id),
        name: typeof e.name === "string" ? e.name : String(e.id),
        state,
      });
      continue;
    }
    if (state === "FINISHED") {
      finishedKeys.push(quest.key);
    } else {
      notFinishedKeys.push(quest.key);
      if (state === "IN_PROGRESS") inProgressCount++;
    }
  }

  // guard against a structurally-plausible but useless file
  if (finishedKeys.length === 0 && notFinishedKeys.length === 0) return null;

  const qp = qpContainer?.questPoints;

  return {
    rsn: typeof obj.rsn === "string" && obj.rsn.trim() ? obj.rsn.trim() : null,
    timestampIso:
      typeof obj.timestampIso === "string"
        ? obj.timestampIso
        : typeof obj.exported_at === "string"
          ? obj.exported_at
          : null,
    fileQuestPoints: typeof qp === "number" ? qp : null,
    finishedKeys,
    notFinishedKeys,
    inProgressCount,
    unmatched,
    source,
  };
}
