import {
  QUESTS,
  QUEST_BY_KEY,
  QUEST_CAPE_KEY,
  QUEST_CAPE_QUEST,
  PlayerSkills,
  Quest,
  SkillReq,
  effectiveLevel,
  levelForXp,
  xpForLevel,
  questPointsAwarded,
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

/** a tracked target quest with its own (post-chain-XP) skill requirements */
export interface TargetResult {
  quest: Quest;
  requirements: SkillGap[]; // all skill reqs (met included)
  gaps: SkillGap[]; // unmet only
}

/**
 * Quest-XP cascade: completing `from` raises `skill` from `levelFrom` to
 * `levelTo`, reaching the first downstream node that requires the same skill.
 * When the new level still isn't enough to complete that node, the edge should
 * attach to the skill's shared training gate (`gate:${skill}` — one diamond per
 * skill across the whole board) instead of the quest node itself.
 */
export interface XpCascade {
  from: string;
  skill: string;
  levelFrom: number;
  levelTo: number;
  toQuest: string;
  toGate: boolean;
}

export interface ResolveResult {
  targets: TargetResult[]; // every tracked target, in the order requested
  steps: ChainStep[];
  skillTotals: SkillGap[]; // aggregated real training needs per skill
  totalQuests: number;
  qpRequired: number | null;
  estQp: number;
  cascades: XpCascade[];
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
      : (player.levels?.[skill] ?? 1);
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

    const curXp = (player.xp?.[skill] ?? 0) + (bonusXp[skill] ?? 0);
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
  targetKeys: string[],
  player: PlayerSkills,
  completed: Set<string>,
  opts: ResolveOptions,
  extras: string[] = [], // user-added XP quests, merged into the plan
): ResolveResult | null {
  // Quest Cape: synthetic "plan everything" target — every non-completed quest
  // becomes the prerequisite set, ordered by the same greedy as a normal run.
  // Multiple targets (tracked together) share one merged prerequisite plan.
  const isCape = targetKeys.includes(QUEST_CAPE_KEY);
  const targets: TargetResult[] = [];
  const targetKeysClean: string[] = [];
  for (const k of targetKeys) {
    const q = k === QUEST_CAPE_KEY ? QUEST_CAPE_QUEST : QUEST_BY_KEY[k];
    if (q && !targetKeysClean.includes(k)) {
      targets.push({ quest: q, requirements: [], gaps: [] }); // filled in after the XP walk
      targetKeysClean.push(k);
    }
  }
  if (targetKeysClean.length === 0) return null;
  const targetKeySet = new Set(targetKeysClean);

  // 1. transitive prerequisite closure (excluding completed quests).
  // A tracked target that is also another target's prerequisite stays in the
  // closure — it's a real step AND a tracked target (UI dedupes the display).
  const prereqClosure = new Set<string>();
  const collect = (key: string) => {
    if (completed.has(key) || prereqClosure.has(key)) return;
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
    for (const tk of targetKeysClean) {
      for (const p of QUEST_BY_KEY[tk]?.quests ?? []) collect(p);
    }
  }

  // user-added quests: merged into the plan WITHOUT pulling in their own prereqs
  const extraKeys: string[] = [];
  for (const k of extras) {
    if (targetKeySet.has(k) || completed.has(k) || !QUEST_BY_KEY[k]) continue;
    if (prereqClosure.has(k)) continue; // already a true prerequisite
    if (!extraKeys.includes(k)) extraKeys.push(k);
  }
  const extraSet = new Set(extraKeys);
  const needed = new Set<string>([...prereqClosure, ...extraKeys]);

  // 2. topological greedy ordering — front-load gateway quests (extras spliced after)
  const withTarget = new Set([...prereqClosure, ...targetKeysClean]);
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

  // 3. walk the chain, accruing quest-given xp and computing per-step requirements.
  // preBonus/postBonus snapshots per step power the XP-cascade computation.
  const bonusXp: Record<string, number> = {};
  const preBonus: Record<string, number>[] = [];
  const postBonus: Record<string, number>[] = [];
  const steps: ChainStep[] = [];

  for (const key of ordered) {
    const q = QUEST_BY_KEY[key];
    preBonus.push({ ...bonusXp });
    const requirements = computeReqGaps(q, player, bonusXp, opts);
    const gaps = requirements.filter((g) => g.status !== "met");

    for (const [s, x] of Object.entries(q.xp)) {
      bonusXp[s] = (bonusXp[s] ?? 0) + x;
    }
    postBonus.push({ ...bonusXp });

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

  // every target's own requirements, evaluated after the whole chain's XP accrues
  for (let i = 0; i < targets.length; i++) {
    const reqs = computeReqGaps(targets[i].quest, player, bonusXp, opts);
    targets[i] = {
      quest: targets[i].quest,
      requirements: reqs,
      gaps: reqs.filter((g) => g.status !== "met"),
    };
  }

  // 3.5 quest-XP cascades — for each XP grant, the first downstream node in the
  // same skill that the resulting level-up reaches ("player has at least the
  // level to complete the granting quest" is folded into the starting level)
  const cascades: XpCascade[] = [];
  const trainGates = new Set<string>(); // skills gated by real training somewhere in the plan
  for (const s of steps) {
    for (const g of s.gaps) if (g.status === "train") trainGates.add(g.skill);
  }
  for (const t of targets) {
    for (const g of t.gaps) if (g.status === "train") trainGates.add(g.skill);
  }
  for (let i = 0; i < steps.length; i++) {
    const q = steps[i].quest;
    for (const [skill, gain] of Object.entries(q.xp)) {
      if (!gain || skill === "Combat") continue; // virtual combat level isn't XP-derivable
      const baseXp = player.xp?.[skill] ?? 0;
      const baseLevel = player.levels?.[skill] ?? 1;
      const ownReq = q.skills[skill]?.level ?? 0;
      // assumed starting level: at least enough to complete this quest
      const L0 = Math.max(ownReq, baseLevel, levelForXp(baseXp + (preBonus[i][skill] ?? 0)));
      const L1 = Math.max(L0, levelForXp(baseXp + (postBonus[i][skill] ?? 0)));
      if (L1 <= L0) continue;
      const attach = (toQuest: string, reqLevel: number): XpCascade => ({
        from: q.key,
        skill,
        levelFrom: L0,
        levelTo: L1,
        toQuest,
        // enough to complete → point at the quest itself; otherwise the
        // skill's shared training diamond (if the skill has one at all)
        toGate: L1 < reqLevel && trainGates.has(skill),
      });
      // first downstream node in this skill whose requirement the level-up reaches
      let found: XpCascade | null = null;
      for (let j = i + 1; j < steps.length && !found; j++) {
        const req = steps[j].quest.skills[skill];
        if (!req || req.level <= L0 || baseLevel >= req.level) continue;
        found = attach(steps[j].quest.key, req.level);
      }
      for (const t of targets) {
        if (found) break;
        if (t.quest.key === q.key) continue;
        const req = t.quest.skills[skill];
        if (!req || req.level <= L0 || baseLevel >= req.level) continue;
        found = attach(t.quest.key, req.level);
      }
      if (found) cascades.push(found);
    }
    if (cascades.length > 80) break;
  }

  // 4. aggregated REAL training needs per skill, merged across all tiers.
  // A skill can be gated at several levels along the plan (49 for one quest,
  // 61 for another) — each tier gap's xpNeeded is the grind measured at its own
  // chain position (quest XP already netted out), so the true total grind is
  // the SUM of the per-tier grinds. The merged entry keeps the final tier's
  // base/effective/flags (its requirement level is the ultimate target) and
  // sums deficit + xpNeeded across tiers. Boost-ok / quest-xp-covered gaps are
  // informational, not grind targets.
  const tierGaps = new Map<string, SkillGap[]>();
  for (const g of [...steps.flatMap((s) => s.gaps), ...targets.flatMap((t) => t.gaps)]) {
    if (g.status !== "train") continue;
    const arr = tierGaps.get(g.skill);
    if (arr) arr.push(g);
    else tierGaps.set(g.skill, [g]);
  }
  const skillTotals: SkillGap[] = [];
  for (const [skill, arr] of tierGaps) {
    arr.sort((a, b) => a.required - b.required || a.xpNeeded - b.xpNeeded);
    const final = arr[arr.length - 1];
    skillTotals.push({
      ...final,
      deficit: arr.reduce((a, g) => a + g.deficit, 0),
      xpNeeded: arr.reduce((a, g) => a + g.xpNeeded, 0),
      // any tier gating on start means raw (unboosted) levels matter for the skill
      requiredToStart: arr.some((g) => g.requiredToStart),
    });
  }
  skillTotals.sort((a, b) => b.xpNeeded - a.xpNeeded || b.deficit - a.deficit);

  // estimated quest points from quests the user marked complete (1 per quest,
  // 0 for miniquests/activities — see questPointsAwarded)
  let estQp = 0;
  for (const key of completed) {
    const q = QUEST_BY_KEY[key];
    if (q) estQp += questPointsAwarded(q);
  }
  const qpRequired = [...steps, ...targets.map((t) => ({ qpReq: t.quest.qp }))].reduce<
    number | null
  >(
    (acc, s) => (s.qpReq !== null ? Math.max(acc ?? 0, s.qpReq) : acc),
    null,
  );

  return { targets, steps, skillTotals, totalQuests: steps.length, qpRequired, estQp, cascades };
}
