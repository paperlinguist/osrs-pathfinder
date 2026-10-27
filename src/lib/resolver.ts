import {
  QUESTS,
  QUEST_BY_KEY,
  QUEST_CAPE_KEY,
  QUEST_CAPE_QUEST,
  PlayerSkills,
  Quest,
  SkillReq,
  effectiveLevel,
  xpForLevel,
} from "./quest-data";

export type GapStatus = "met" | "covered-by-quest-xp" | "boost-ok" | "train";

export interface SkillGap {
  skill: string;
  required: number;
  base: number; // player's real (unboosted, un-quest-xp) level
  effective: number; // base + quest xp from earlier chain steps
  status: GapStatus;
  deficit: number; // levels still to train (0 unless status=train)
  xpNeeded: number; // raw xp still to train (0 unless status=train)
  boostable: boolean;
  requiredToStart: boolean;
}

export interface ChainStep {
  quest: Quest;
  requirements: SkillGap[]; // ALL skill requirements (met included) — for per-quest display
  gaps: SkillGap[]; // unmet only
  needsTraining: boolean;
  qpReq: number | null;
  unlocks: number; // how many remaining chain quests this directly/transitively enables
  isExtra?: boolean; // user-added XP quest (not a true prerequisite)
  missingPrereqs?: string[]; // for extras: prereqs neither completed nor in the plan
}

export interface ResolveOptions {
  allowBoosts: boolean; // treat boostable (non-start) reqs as satisfiable with potions
  includeQuestXp: boolean; // factor quest-given xp into later requirements
}

export interface ResolveResult {
  target: Quest;
  steps: ChainStep[];
  skillTotals: SkillGap[]; // aggregated real training needs per skill
  totalQuests: number;
  qpRequired: number | null;
  estQp: number;
  targetRequirements: SkillGap[]; // target's own skill reqs (met included)
  targetGaps: SkillGap[]; // target's own unmet reqs
}

const difficultyRank: Record<string, number> = {
  Novice: 1, Intermediate: 2, Experienced: 3, Master: 4, Grandmaster: 5,
  Special: 3, Miniquest: 1, Activity: 1, Unknown: 3,
};

function buildUnlockMap(needed: Set<string>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const key of needed) {
    const q = QUEST_BY_KEY[key];
    if (!q) continue;
    for (const p of q.quests) {
      if (needed.has(p)) {
        if (!m.has(p)) m.set(p, []);
        m.get(p)!.push(key);
      }
    }
  }
  return m;
}

/** compute gaps for every skill requirement of a quest, given accrued bonus xp */
function computeReqGaps(
  q: Quest,
  player: PlayerSkills,
  bonusXp: Record<string, number>,
  opts: ResolveOptions,
): SkillGap[] {
  const gaps: SkillGap[] = [];
  for (const [skill, req] of Object.entries(q.skills) as [string, SkillReq][]) {
    const base = skill === "Combat"
      ? (player.combatLevel ?? 0)
      : (player.levels[skill] ?? 1);
    const eff = opts.includeQuestXp
      ? effectiveLevel(player, skill, bonusXp[skill] ?? 0)
      : base;

    let status: GapStatus;
    if (base >= req.level) {
      status = "met";
    } else if (req.requiredToStart) {
      // must start with the raw level — boosts & quest xp can't front-run the gate,
      // but quest xp earned earlier in the chain still counts as real levels
      status = eff >= req.level ? "covered-by-quest-xp" : "train";
    } else if (eff >= req.level) {
      status = "covered-by-quest-xp";
    } else if (opts.allowBoosts && req.boostable && skill !== "Combat") {
      status = "boost-ok";
    } else {
      status = "train";
    }

    const curXp = (player.xp[skill] ?? 0) + (bonusXp[skill] ?? 0);
    const xpNeeded = status === "train"
      ? Math.max(0, xpForLevel(Math.min(99, req.level + 1)) - curXp)
      : 0;

    gaps.push({
      skill, required: req.level, base, effective: eff, status,
      deficit: status === "train" ? Math.max(0, req.level - (req.requiredToStart ? base : eff)) : 0,
      xpNeeded, boostable: req.boostable, requiredToStart: req.requiredToStart,
    });
  }
  return gaps;
}

/**
 * Skill gaps for a quest that is NOT part of the plan (suggestion cards, add
 * dialogs): evaluated with no quest-XP credit, since nothing has been earned
 * toward it yet. Boost/quest-XP toggles still shape the statuses.
 */
export function questSkillGaps(
  q: Quest,
  player: PlayerSkills,
  opts: ResolveOptions,
): SkillGap[] {
  return computeReqGaps(q, player, {}, opts);
}

/**
 * Transitive prerequisites of `questKey` that are neither completed nor already
 * in the plan. Used when a user-added XP quest needs its gate quests pulled in:
 * extras are merged into resolveChain WITHOUT auto-pulling prereqs, so callers
 * use this to warn the user and add the full closure explicitly.
 */
export function missingPrereqClosure(
  questKey: string,
  completed: Set<string>,
  inPlan: Set<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (key: string) => {
    const q = QUEST_BY_KEY[key];
    if (!q) return;
    for (const p of q.quests) {
      if (p === questKey || completed.has(p) || inPlan.has(p) || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      walk(p);
    }
  };
  walk(questKey);
  return out;
}

export function resolveChain(
  targetKey: string,
  player: PlayerSkills,
  completed: Set<string>,
  opts: ResolveOptions,
  extras: string[] = [], // user-added XP quests, merged into the plan
): ResolveResult | null {
  // Quest Cape: synthetic "plan everything" target — every non-completed quest
  // becomes the prerequisite set, ordered by the same greedy as a normal run
  const isCape = targetKey === QUEST_CAPE_KEY;
  const target = isCape ? QUEST_CAPE_QUEST : QUEST_BY_KEY[targetKey];
  if (!target) return null;

  // 1. transitive prerequisite closure (excluding completed quests)
  const prereqClosure = new Set<string>();
  const collect = (key: string) => {
    if (completed.has(key) || prereqClosure.has(key) || key === targetKey) return;
    const q = QUEST_BY_KEY[key];
    if (!q) return;
    prereqClosure.add(key);
    for (const p of q.quests) collect(p);
  };
  if (isCape) {
    for (const q of QUESTS) {
      if (!completed.has(q.key)) prereqClosure.add(q.key);
    }
  } else {
    for (const p of target.quests) collect(p);
  }

  // user-added quests: merged into the plan WITHOUT pulling in their own prereqs
  const extraKeys: string[] = [];
  for (const k of extras) {
    if (k === targetKey || completed.has(k) || !QUEST_BY_KEY[k]) continue;
    if (prereqClosure.has(k)) continue; // already a true prerequisite
    if (!extraKeys.includes(k)) extraKeys.push(k);
  }
  const extraSet = new Set(extraKeys);
  const needed = new Set<string>([...prereqClosure, ...extraKeys]);

  // 2. topological greedy ordering — front-load gateway quests (extras spliced after)
  const withTarget = new Set([...prereqClosure, targetKey]);
  const unlockMap = buildUnlockMap(withTarget);
  const remaining = new Set(prereqClosure);
  const placed = new Set<string>();
  const ordered: string[] = [];

  const transitiveUnlocks = (key: string): number => {
    const seen = new Set<string>();
    const stack = [key];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nxt of unlockMap.get(cur) ?? []) {
        if (remaining.has(nxt) && !seen.has(nxt)) {
          seen.add(nxt);
          stack.push(nxt);
        }
      }
    }
    return seen.size;
  };

  const isReady = (key: string): boolean =>
    QUEST_BY_KEY[key].quests.every((p) => !remaining.has(p) || placed.has(p));

  while (remaining.size > 0) {
    let best: string | null = null;
    let bestUnlocks = -1;
    let bestXp = -1;
    let bestDiff = 99;
    for (const key of remaining) {
      if (!isReady(key)) continue;
      const q = QUEST_BY_KEY[key];
      const unlocks = transitiveUnlocks(key);
      const xpSum = Object.values(q.xp).reduce((a, b) => a + b, 0);
      const diff = difficultyRank[q.difficulty] ?? 3;
      if (
        unlocks > bestUnlocks ||
        (unlocks === bestUnlocks && xpSum > bestXp) ||
        (unlocks === bestUnlocks && xpSum === bestXp && diff < bestDiff)
      ) {
        best = key; bestUnlocks = unlocks; bestXp = xpSum; bestDiff = diff;
      }
    }
    if (best === null) {
      // should not happen (acyclic graph) — fall back to insertion order
      for (const key of [...remaining]) { ordered.push(key); placed.add(key); remaining.delete(key); }
      break;
    }
    ordered.push(best);
    placed.add(best);
    remaining.delete(best);
  }

  // splice user-added XP quests into the order: highest total XP first, each placed
  // right after its last in-plan prerequisite (or at the front) so its XP counts
  // toward as many later skill gates as possible
  const xpSumOf = (key: string) =>
    Object.values(QUEST_BY_KEY[key].xp).reduce((a, b) => a + b, 0);
  for (const k of [...extraKeys].sort((a, b) => xpSumOf(b) - xpSumOf(a))) {
    let pos = 0;
    for (const p of QUEST_BY_KEY[k].quests) {
      const idx = ordered.indexOf(p);
      if (idx >= 0) pos = Math.max(pos, idx + 1);
    }
    ordered.splice(pos, 0, k);
  }

  // 3. walk the chain, accruing quest-given xp and computing per-step requirements
  const bonusXp: Record<string, number> = {};
  const steps: ChainStep[] = [];

  for (const key of ordered) {
    const q = QUEST_BY_KEY[key];
    const requirements = computeReqGaps(q, player, bonusXp, opts);
    const gaps = requirements.filter((g) => g.status !== "met");

    for (const [s, x] of Object.entries(q.xp)) {
      bonusXp[s] = (bonusXp[s] ?? 0) + x;
    }

    const isExtra = extraSet.has(key);
    const missingPrereqs = isExtra
      ? q.quests.filter((p) => !completed.has(p) && !needed.has(p))
      : undefined;

    steps.push({
      quest: q,
      requirements,
      gaps,
      needsTraining: gaps.some((g) => g.status === "train"),
      qpReq: q.qp,
      unlocks: transitiveUnlocks(key),
      isExtra,
      missingPrereqs,
    });
  }

  // the target's own requirements, evaluated after the whole chain's XP accrues
  const targetRequirements = computeReqGaps(target, player, bonusXp, opts);
  const targetGaps = targetRequirements.filter((g) => g.status !== "met");

  // 4. aggregated REAL training needs per skill (worst gap by xpNeeded);
  //    boost-ok / quest-xp-covered gaps are informational, not grind targets
  const totalsMap = new Map<string, SkillGap>();
  for (const g of [...steps.flatMap((s) => s.gaps), ...targetGaps]) {
    if (g.status !== "train") continue;
    const prev = totalsMap.get(g.skill);
    if (!prev || g.xpNeeded > prev.xpNeeded) totalsMap.set(g.skill, g);
  }
  const skillTotals = [...totalsMap.values()].sort(
    (a, b) => b.xpNeeded - a.xpNeeded || b.deficit - a.deficit,
  );

  // estimated quest points from quests the user marked complete
  let estQp = 0;
  for (const key of completed) {
    const q = QUEST_BY_KEY[key];
    if (q?.qp) estQp += q.qp;
  }
  const qpRequired = [...steps, { qpReq: target.qp }].reduce<number | null>(
    (acc, s) => (s.qpReq !== null ? Math.max(acc ?? 0, s.qpReq) : acc),
    null,
  );

  return { target, steps, skillTotals, totalQuests: steps.length, qpRequired, estQp, targetRequirements, targetGaps };
}
