import skillsJson from "@/data/skills.json";
import {
  QUESTS,
  DIARY_QUESTS,
  QUEST_BY_KEY,
  type PlayerSkills,
  type Quest,
  trainHours,
  xpForLevel,
  formatHours,
} from "./quest-data";
import { questSkillGaps, missingPrereqClosure } from "./resolver";

/**
 * Skill explorer — per-skill quest XP rewards, level-gated unlocks and
 * curated training methods. Everything quest-related is DERIVED from the
 * existing datasets (quests + diaries) and the resolver's gap engine; only
 * the training-method blurbs are curated (src/data/skills.json).
 */

export interface TrainingMethod {
  level: number;
  name: string;
  /** rough XP/hour — null when no stable published rate */
  xpHour: number | null;
  note: string;
}

export interface SkillInfo {
  /** wiki guide page name for the training link */
  guide: string;
  methods: TrainingMethod[];
}

export const SKILL_INFO: Record<string, SkillInfo> = (skillsJson as {
  skills: Record<string, SkillInfo>;
}).skills;

/* --------------------------------------------------------- XP rewards side */

export type RewardStatus = "completed" | "ready" | "boost" | "gated";

export interface SkillRewardRow {
  key: string;
  name: string;
  xp: number;
  status: RewardStatus;
  /** short gate descriptions when status=gated ("Ranged 70", "3 quests") */
  gates: string[];
  isDiary: boolean;
}

export interface RewardOpts {
  allowBoosts: boolean;
  includeQuestXp: boolean;
}

/**
 * Every quest/diary that grants XP in `skill`, bucketed by what's holding it
 * back: completed, ready to do now, ready with a boost, or gated (skill
 * levels or prerequisite quests missing). Sorted XP-desc within buckets.
 */
export function skillRewards(
  skill: string,
  player: PlayerSkills | null,
  completed: Set<string> | null,
  opts: RewardOpts,
): SkillRewardRow[] {
  const done = completed ?? new Set<string>();
  const rows: SkillRewardRow[] = [];

  for (const q of QUESTS) {
    const xp = q.xp?.[skill] ?? 0;
    if (xp <= 0) continue;

    let status: RewardStatus;
    const gates: string[] = [];
    if (done.has(q.key)) {
      status = "completed";
    } else {
      const trainGates = questSkillGaps(q, player ?? { levels: {}, xp: {}, source: "manual" }, opts)
        .filter((g) => g.status === "train");
      const missingQuests = missingPrereqClosure(q.key, done, new Set());
      if (trainGates.length === 0 && missingQuests.length === 0) {
        const boostable = questSkillGaps(q, player ?? { levels: {}, xp: {}, source: "manual" }, opts)
          .filter((g) => g.status === "boost-ok");
        status = boostable.length > 0 ? "boost" : "ready";
        if (boostable.length > 0) {
          gates.push(...boostable.map((g) => `${g.skill} ${g.required} (boostable)`));
        }
      } else {
        status = "gated";
        for (const g of trainGates) gates.push(`${g.skill} ${g.required}`);
        if (missingQuests.length > 0) gates.push(`${missingQuests.length} prerequisite quest${missingQuests.length === 1 ? "" : "s"}`);
      }
    }
    rows.push({ key: q.key, name: q.name, xp, status, gates, isDiary: false });
  }

  const order: Record<RewardStatus, number> = { ready: 0, boost: 1, gated: 2, completed: 3 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || b.xp - a.xp);
}

/* --------------------------------------------------------- unlock side */

export interface SkillUnlockRow {
  key: string;
  name: string;
  required: number;
  unlocked: boolean | null; // null = no player imported
  completed: boolean | null; // null = no completion data
  isDiary: boolean;
}

/** Every quest/diary that REQUIRES `skill`, for the "what does this level buy you" view. */
export function skillUnlocks(
  skill: string,
  player: PlayerSkills | null,
  completed: Set<string> | null,
): SkillUnlockRow[] {
  const level = player ? (player.levels[skill] ?? 1) : null;
  const rows: SkillUnlockRow[] = [];
  for (const q of [...QUESTS, ...DIARY_QUESTS] as Quest[]) {
    const req = q.skills?.[skill]?.level;
    if (!req) continue;
    rows.push({
      key: q.key,
      name: q.name,
      required: req,
      unlocked: level === null ? null : level >= req,
      completed: completed === null ? null : completed.has(q.key),
      // QUEST_BY_KEY covers real quests only — anything else is a diary tier
      isDiary: !QUEST_BY_KEY[q.key],
    });
  }
  return rows.sort((a, b) => a.required - b.required || a.name.localeCompare(b.name));
}

/* --------------------------------------------------------- milestones */

export interface SkillMilestone {
  level: number;
  xpNeeded: number;
  hours: string | null;
}

/** next round level (or 99) the player hasn't reached, with the training estimate */
export function nextMilestone(skill: string, player: PlayerSkills): SkillMilestone | null {
  const current = player.levels[skill] ?? 1;
  if (current >= 99) return null;
  let target = Math.floor(current / 10) * 10 + 10;
  if (target > 99) target = 99;
  const xpNeeded = Math.max(0, xpForLevel(target + 1) - (player.xp?.[skill] ?? 0));
  const hours = trainHours(skill, xpNeeded);
  return { level: target, xpNeeded, hours: hours === null ? null : formatHours(hours) };
}

/** total quest XP available in a skill from quests not yet completed */
export function pendingQuestXp(skill: string, completed: Set<string> | null): number {
  const done = completed ?? new Set<string>();
  return QUESTS
    .filter((q) => !done.has(q.key))
    .reduce((a, q) => a + (q.xp?.[skill] ?? 0), 0);
}
