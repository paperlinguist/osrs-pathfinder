import { QUESTS, type Quest } from "@/lib/quest-data";

/**
 * Parser for JSON files written by the RuneLite "Quest State Exporter" plugin
 * (https://runelite.net/plugin-hub/show/quest-state-exporter).
 *
 * File shape:
 * {
 *   "schemaVersion": "1.0.0", "exportVersion": "1.0.0",
 *   "timestampIso": "2026-10-27T19:52:11.690491800Z", "rsn": "Wren von Arx",
 *   "quests": { "notStarted": 179, "inProgress": 4, "finished": 31,
 *               "unknown": 0, "total": 214, "questPoints": 47,
 *               "entries": [{ "id": "ANIMAL_MAGNETISM",
 *                             "name": "Animal Magnetism", "state": "FINISHED" }, ...] }
 * }
 *
 * Entry `id`s are RuneLite quest enum names and match our quest data's `enum`
 * field 1:1 (verified against the full 214-quest plugin output), so mapping is
 * a straight lookup.
 */

export interface QuestStateEntry {
  id: string;
  name: string;
  state: string;
}

export interface ParsedQuestState {
  /** character name from the file, if present */
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
}

// enum -> quest lookup (plugin ids are RuneLite enum names, uppercase)
const QUEST_BY_ENUM: ReadonlyMap<string, Quest> = new Map(
  QUESTS.filter((q) => q.enum).map((q) => [q.enum, q]),
);

/**
 * Parse and map a Quest State Exporter JSON payload.
 * Returns `null` when the payload doesn't look like a quest-state export at
 * all (wrong shape / empty entries) so the caller can show a clean error.
 */
export function parseQuestStateExport(raw: unknown): ParsedQuestState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const quests = obj.quests;
  if (!quests || typeof quests !== "object" || Array.isArray(quests)) return null;
  const entries = (quests as Record<string, unknown>).entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const finishedKeys: string[] = [];
  const notFinishedKeys: string[] = [];
  const unmatched: QuestStateEntry[] = [];
  let inProgressCount = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string") continue;
    const quest = QUEST_BY_ENUM.get(e.id.toUpperCase());
    const state = typeof e.state === "string" ? e.state : "";
    if (!quest) {
      unmatched.push({
        id: e.id,
        name: typeof e.name === "string" ? e.name : e.id,
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

  const qp = (quests as Record<string, unknown>).questPoints;

  return {
    rsn: typeof obj.rsn === "string" && obj.rsn.trim() ? obj.rsn.trim() : null,
    timestampIso: typeof obj.timestampIso === "string" ? obj.timestampIso : null,
    fileQuestPoints: typeof qp === "number" ? qp : null,
    finishedKeys,
    notFinishedKeys,
    inProgressCount,
    unmatched,
  };
}
