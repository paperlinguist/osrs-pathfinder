/**
 * Route-solver verification harness (pure lib — no React).
 *
 * Same run recipe as verify-graph-layout.ts:
 *   npx tsc tools/verify-route-solver.ts --outDir .verify --module commonjs \
 *       --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
 *   sed -i 's#@/data/quests.json#../../data/quests.json#' .verify/src/lib/quest-data.js
 *   mkdir -p .verify/data && cp src/data/quests.json .verify/data/
 *   node .verify/tools/verify-route-solver.js
 */

import { QUEST_BY_KEY, SKILL_NAMES, xpForLevel, type PlayerSkills } from "../src/lib/quest-data";
import { resolveChain } from "../src/lib/resolver";
import { solveXpRoute } from "../src/lib/route-solver";

let failures = 0;
let checks = 0;

function check(ok: boolean, label: string, detail?: string) {
  checks++;
  if (!ok) {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function mkPlayer(over: Record<string, number>): PlayerSkills {
  const levels: Record<string, number> = {};
  const xp: Record<string, number> = {};
  for (const s of SKILL_NAMES) {
    levels[s] = over[s] ?? 99;
    xp[s] = xpForLevel(levels[s]);
  }
  return { levels, xp, combatLevel: over.Combat ?? 126, source: "manual" };
}

const OPTS = { allowBoosts: false, includeQuestXp: true };
const totalTrainXp = (r: ReturnType<typeof resolveChain>) =>
  r!.skillTotals.reduce((a, g) => a + g.xpNeeded, 0);

/* ---- Scenario A: Lunar Diplomacy, Crafting 40 → route must beat training - */

console.log("Scenario A — Lunar Diplomacy at Crafting 40");
{
  const player = mkPlayer({ Crafting: 40 });
  const proposal = solveXpRoute(["lunar diplomacy"], player, new Set(), OPTS, []);
  check(!!proposal, "solver returns a proposal");
  if (proposal) {
    const baseline = totalTrainXp(resolveChain(["lunar diplomacy"], player, new Set(), OPTS, []));
    check(baseline > 0, "plan has training to save", String(baseline));
    check(proposal.baselineXp === baseline, "baseline matches an independent resolve");
    check(proposal.steps.length >= 1, "finds at least one route step", `${proposal.steps.length} steps`);
    check(
      proposal.savedXp === proposal.baselineXp - proposal.finalXp && proposal.savedXp >= 1_000,
      "route saves ≥ 1,000 XP",
      `saved ${proposal.savedXp}`,
    );
    check(
      proposal.steps.every((s) => s.savedXp >= 1_000),
      "every step removed ≥ 1,000 XP (minGain respected)",
    );
    check(
      proposal.steps.length <= 8,
      "route length capped",
      String(proposal.steps.length),
    );

    // independent verification: adding the route really lowers the total by
    // at least the promised amount (the greedy total is recomputed, not trusted)
    const after = resolveChain(
      ["lunar diplomacy"],
      player,
      new Set(),
      OPTS,
      proposal.addKeys,
    );
    check(
      !!after && baseline - totalTrainXp(after) >= proposal.savedXp - 1,
      "independent re-resolve confirms the savings",
      after ? `actual ${baseline - totalTrainXp(after)} vs promised ${proposal.savedXp}` : "null",
    );

    // chicken-and-egg: Hand in the Sand (train to raw 49 to start, 9k reward)
    // cannot be the FIRST step — at Crafting 40 its own gate costs more than
    // its reward. It MAY appear later, once earlier route XP covers the 49.
    const hand = proposal.steps.find((s) => s.key === "hand in sand");
    check(
      !hand || proposal.steps.indexOf(hand) > 0,
      "circular quest never opens the route (Hand in the Sand)",
    );
    const first = proposal.steps[0];
    if (first) {
      // the opening step must be doable at the player's raw levels: none of
      // its skill reqs may exceed what the player has right now
      const firstQ = QUEST_BY_KEY[first.key];
      const doable =
        firstQ !== undefined &&
        Object.entries(firstQ.skills).every(
          ([skill, req]) =>
            req.level <= (skill === "Combat" ? (player.combatLevel ?? 0) : (player.levels[skill] ?? 1)),
        );
      check(doable, "opening step is doable at raw levels", first?.name);
    }
    // time-aware: no absurd prerequisite-chain steps make the route
    check(
      !proposal.steps.some((s) => s.prereqCount > 12),
      "no step drags a huge prerequisite chain (time floor works)",
      proposal.steps.map((s) => `${s.name}(${s.prereqCount})`).join(", "),
    );

    // every proposed key is a real, not-completed quest
    check(
      proposal.addKeys.every((k) => !!QUEST_BY_KEY[k]),
      "all add keys are real quests",
    );
  }
}

/* ---- Scenario B: higher Crafting — circularity flips --------------------- */

console.log("Scenario B — Lunar Diplomacy at Crafting 48");
{
  // at 48, Hand in the Sand's 49 gate costs one level (~9.6k XP in this
  // dataset) but its 9k reward cascades toward 61 — borderline. Whatever the
  // solver picks, the invariant holds: total must not increase.
  const player = mkPlayer({ Crafting: 48 });
  const proposal = solveXpRoute(["lunar diplomacy"], player, new Set(), OPTS, []);
  check(!!proposal, "solver returns a proposal");
  if (proposal) {
    check(
      proposal.finalXp <= proposal.baselineXp,
      "route never increases total training",
      `${proposal.finalXp} vs ${proposal.baselineXp}`,
    );
    for (const s of proposal.steps) {
      check(!!QUEST_BY_KEY[s.key], `step is a real quest (${s.key})`);
    }
  }
}

/* ---- Scenario C: nothing to save / everything planned --------------------- */

console.log("Scenario C — degenerate inputs");
{
  // rune mysteries has no skill reqs → no gates → empty route, no crash
  const p1 = solveXpRoute(["rune mysteries"], mkPlayer({}), new Set(), OPTS, []);
  check(!!p1 && p1.steps.length === 0 && p1.savedXp === 0, "no gates → empty route");

  // quest cape: every quest is already in the plan → nothing to propose
  const p2 = solveXpRoute(["__quest_cape__"], mkPlayer({ Crafting: 1 }), new Set(), OPTS, []);
  check(!!p2 && p2.steps.length === 0, "cape mode → empty route (everything planned)");

  // no targets at all → null
  const p3 = solveXpRoute([], mkPlayer({}), new Set(), OPTS, []);
  check(p3 === null, "no targets → null");
}

/* ---- Scenario D: existing extras are respected ---------------------------- */

console.log("Scenario D — current extras respected");
{
  const player = mkPlayer({ Crafting: 40 });
  const extras = ["elemental workshop i"];
  const proposal = solveXpRoute(["lunar diplomacy"], player, new Set(), OPTS, extras);
  check(!!proposal, "solver returns a proposal");
  if (proposal) {
    const baseWithExtras = totalTrainXp(
      resolveChain(["lunar diplomacy"], player, new Set(), OPTS, extras),
    );
    check(proposal.baselineXp === baseWithExtras, "baseline includes current extras");
    check(
      !proposal.addKeys.includes("elemental workshop i"),
      "never re-proposes an already-added quest",
    );
  }
}

console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
if (failures > 0) process.exit(1);
