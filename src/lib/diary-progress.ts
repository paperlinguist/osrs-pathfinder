import type { Diary, PlayerSkills } from "./quest-data";

/**
 * Diary-explorer readiness — the diary counterpart of boss-readiness.
 * Evaluates one diary tier's skill + quest requirements against the imported
 * character and completions (which already carry diary tiers as pseudo-quest
 * keys), and ranks tiers by how close they are to completion.
 */

export interface DiarySkillGap {
  skill: string;
  required: number;
  current: number | null; // null = no character imported
  boostable: boolean;
  met: boolean;
}

export interface DiaryQuestGap {
  key: string;
  done: boolean | null; // null = no completion data
}

export type DiaryStatus = "done" | "ready" | "incomplete" | "unknown";

export interface DiaryProgress {
  diary: Diary;
  status: DiaryStatus;
  /** unmet skill requirements */
  skillGaps: DiarySkillGap[];
  metSkills: DiarySkillGap[];
  /** unmet quest requirements */
  questGaps: DiaryQuestGap[];
  metQuests: DiaryQuestGap[];
  /** lower = closer to done — sort key for the "closest first" view */
  remainingCount: number;
}

export function diaryProgress(
  diary: Diary,
  player: PlayerSkills | null,
  completed: Set<string> | null,
): DiaryProgress {
  const done = completed?.has(diary.key) ?? false;

  const skills: DiarySkillGap[] = Object.entries(diary.skills ?? {}).map(([skill, req]) => {
    const current = player ? (player.levels[skill] ?? 1) : null;
    return {
      skill,
      required: req.level,
      current,
      boostable: req.boostable ?? false,
      met: current !== null && current >= req.level,
    };
  });

  const quests: DiaryQuestGap[] = diary.quests.map((key) => ({
    key,
    done: completed === null ? null : completed.has(key),
  }));

  const skillGaps = skills.filter((s) => !s.met);
  const metSkills = skills.filter((s) => s.met);
  const questGaps = quests.filter((q) => q.done === false);
  const metQuests = quests.filter((q) => q.done === true);

  let status: DiaryStatus;
  if (player === null && completed === null) {
    status = "unknown";
  } else if (done) {
    status = "done";
  } else if (
    skillGaps.length === 0 &&
    questGaps.length === 0 &&
    quests.every((q) => q.done !== null) // no unknown quest state pretending readiness
  ) {
    status = "ready";
  } else {
    status = "incomplete";
  }

  return {
    diary,
    status,
    skillGaps,
    metSkills,
    questGaps,
    metQuests,
    remainingCount: skillGaps.length + questGaps.length,
  };
}
