/**
 * XP-route solver — the "advanced" counterpart to the static suggestion list.
 *
 * Greedy search over full plan simulations: for each round, every candidate
 * quest is spliced into the plan via resolveChain and the total remaining
 * training XP is compared. Because the resolver folds a candidate's OWN unmet
 * requirements into that total, a quest gated behind more training than its
 * reward removes can never win a round — the chicken-and-egg suggestions the
 * static list shows are filtered here by construction, and cross-skill routes
 * (a quest whose Magic XP happens to close another gate) fall out for free.
 */

import { QUESTS, QUEST_BY_KEY, questMinutes, type PlayerSkills } from "./quest-data";
import { missingPrereqClosure, resolveChain, type ResolveOptions, type ResolveResult } from "./resolver";

export interface RouteStep {
  key: string;
  name: string;
  savedXp: number; // training XP this step removed versus the previous round
  minutes: number | null; // the quest's own length estimate
  prereqCount: number; // extra gate quests this step pulls into the plan
}

export interface RouteProposal {
  steps: RouteStep[]; // chosen quests, best-first
  addKeys: string[]; // steps + their prereq closures — what to add to the plan
  baselineXp: number; // total training XP before the route
  finalXp: number; // total training XP after the route
  savedXp: number; // baseline − final
  estMinutes: number; // summed known length estimates (steps + closures)
}

export interface RouteOptions {
  maxQuests?: number; // route length cap (default 8)
  minGain?: number; // a step must remove at least this much training XP (default 1,000)
  /** a step must also save at least this much XP per estimated minute of
   *  questing (default 50) — a 30-prereq chain saving 7k XP never beats
   *  just training, and this keeps such routes out of the proposal */
  minGainPerMinute?: number;
}

const totalTrainXp = (r: ResolveResult) =>
  r.skillTotals.reduce((a, g) => a + g.xpNeeded, 0);

const planKeysOf = (r: ResolveResult) =>
  new Set<string>([...r.steps.map((s) => s.quest.key), ...r.targets.map((t) => t.quest.key)]);

/**
 * Find a quest route that cuts the plan's total training XP. Returns a
 * proposal whose `steps` may be empty when nothing beats plain training
 * (or everything is already planned, e.g. Quest Cape mode). Returns null
 * only when the plan itself can't resolve (no targets).
 */
export function solveXpRoute(
  targetKeys: string[],
  player: PlayerSkills,
  completed: Set<string>,
  opts: ResolveOptions,
  currentExtras: string[],
  routeOpts: RouteOptions = {},
): RouteProposal | null {
  const maxQuests = routeOpts.maxQuests ?? 8;
  const minGain = routeOpts.minGain ?? 1_000;
  const minRate = routeOpts.minGainPerMinute ?? 50;
  // unknown wiki lengths are estimated as a Medium quest so they can't
  // game the XP-per-minute floor
  const stepMinutes = (key: string, closure: string[]) =>
    (questMinutes(QUEST_BY_KEY[key]) ?? 25) +
    closure.reduce((a, k) => a + (questMinutes(QUEST_BY_KEY[k]) ?? 25), 0);

  const base = resolveChain(targetKeys, player, completed, opts, currentExtras);
  if (!base) return null;

  let sim = base;
  let total = totalTrainXp(sim);
  const baselineXp = total;
  const inPlan = planKeysOf(sim); // includes current extras (they are steps)
  const newKeys: string[] = [];
  const steps: RouteStep[] = [];
  let estMinutes = 0;

  for (let round = 0; round < maxQuests && total > 0; round++) {
    const gatedSkills = new Set(sim.skillTotals.map((g) => g.skill));
    if (gatedSkills.size === 0) break;

    let best: {
      key: string;
      closure: string[];
      gain: number;
      rate: number;
      res: ResolveResult;
    } | null = null;

    for (const q of QUESTS) {
      if (completed.has(q.key) || inPlan.has(q.key) || newKeys.includes(q.key)) continue;
      // a quest can never remove more training XP than it grants in gated
      // skills — cheap prune before the expensive simulation
      let grants = 0;
      for (const [skill, xp] of Object.entries(q.xp)) {
        if (xp > 0 && gatedSkills.has(skill)) grants += xp;
      }
      if (grants < minGain) continue;

      const closure = missingPrereqClosure(q.key, completed, inPlan);
      const res = resolveChain(
        targetKeys,
        player,
        completed,
        opts,
        [...currentExtras, ...newKeys, q.key, ...closure],
      );
      if (!res) continue;
      const after = totalTrainXp(res);
      const gain = total - after;
      // the candidate's own unmet reqs are already priced into `after` —
      // only quests whose reward out-weighs every gate they add survive;
      // ranking (and the floor) is XP saved per estimated minute so huge
      // prerequisite chains for modest gains never make the route
      const rate = gain / Math.max(1, stepMinutes(q.key, closure));
      if (gain >= minGain && rate >= minRate && (!best || rate > best.rate)) {
        best = { key: q.key, closure, gain, rate, res };
      }
    }

    if (!best) break; // nothing left that beats training at an efficient rate

    const q = QUEST_BY_KEY[best.key];
    const prereqMinutes = best.closure.reduce(
      (a, k) => a + (questMinutes(QUEST_BY_KEY[k]) ?? 0),
      0,
    );
    const minutes = questMinutes(q);
    steps.push({
      key: best.key,
      name: q?.name ?? best.key,
      savedXp: best.gain,
      minutes,
      prereqCount: best.closure.length,
    });
    newKeys.push(best.key, ...best.closure);
    inPlan.add(best.key);
    for (const k of best.closure) inPlan.add(k);
    estMinutes += (minutes ?? 0) + prereqMinutes;
    sim = best.res;
    total -= best.gain;
  }

  return {
    steps,
    addKeys: newKeys,
    baselineXp,
    finalXp: total,
    savedXp: baselineXp - total,
    estMinutes,
  };
}
