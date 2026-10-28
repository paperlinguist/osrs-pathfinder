/**
 * Graph-layout verification harness (pure lib — no React needed).
 *
 * Run (repo root):
 *   npx tsc tools/verify-graph-layout.ts --outDir .verify --module commonjs \
 *       --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck \
 *       --resolveJsonModule
 *   # quest-data uses the "@/data" alias — patch the compiled require + copy the json:
 *   sed -i 's#@/data/quests.json#../../data/quests.json#' .verify/src/lib/quest-data.js
 *   mkdir -p .verify/data && cp src/data/quests.json .verify/data/
 *   node .verify/tools/verify-graph-layout.js
 *
 * Scenarios mirror the UI bugs this layout exists to prevent:
 *   A. manually-added quests must tier-chain their shared skill requirement
 *      (Lunar Diplomacy + The Hand in the Sand → Crafting 49 and 61 diamonds,
 *      with a line from the 49-fed quest up to the 61 diamond)
 *   B. XP cascades that don't complete a requirement must attach to that
 *      requirement's own tier diamond
 *   C. the Quest Cape pseudo-target must not crash the layout (it has no
 *      dataset entry) — full-board stress test with global invariants
 */

import {
  CORRIDOR_SEP,
  GATE_H,
  NODE_H,
  computeLayout,
  type LayoutEdge,
  type LayoutNode,
} from "../src/lib/graph-layout";
import {
  QUEST_BY_KEY,
  SKILL_NAMES,
  levelForXp,
  xpForLevel,
  type PlayerSkills,
} from "../src/lib/quest-data";
import { resolveChain } from "../src/lib/resolver";

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
    xp[s] = xpForLevel(levels[s]); // xp consistent with the level (like an import)
  }
  return {
    levels,
    xp,
    combatLevel: over.Combat ?? 126,
    source: "manual",
  };
}

const OPTS = { allowBoosts: false, includeQuestXp: true };

function layoutFor(targetKeys: string[], extras: string[], player: PlayerSkills) {
  const r = resolveChain(targetKeys, player, new Set(), OPTS, extras);
  if (!r) throw new Error("resolveChain returned null");
  return { r, ...computeLayout(r.steps, r.targets, r.cascades) };
}

/** Global invariants that must hold on ANY board. */
function assertInvariants(nodes: LayoutNode[], edges: LayoutEdge[], label: string) {
  const ids = new Set(nodes.map((n) => n.id));
  const pos = new Map(nodes.map((n) => [n.id, n] as const));

  // 1. every edge endpoint exists
  for (const e of edges) {
    check(ids.has(e.source) && ids.has(e.target), `${label}: edge endpoints exist`, e.id);
  }

  // 2. attach points are distinct per node side AND handle (a gate's
  //    bottom-vertex fan and its tier-chain exits are separate attach sites)
  const sideAttach = (pick: (e: LayoutEdge) => [string, string, number]) => {
    const bySite = new Map<string, number[]>();
    for (const e of edges) {
      const [id, handle, x] = pick(e);
      const key = `${id}|${handle}`;
      const arr = bySite.get(key);
      if (arr) arr.push(x);
      else bySite.set(key, [x]);
    }
    for (const [key, xs] of bySite) {
      const sorted = [...xs].sort((a, b) => a - b);
      let minGap = Infinity;
      for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i] - sorted[i - 1]);
      check(
        minGap > 0.5,
        `${label}: distinct attach points on ${key}`,
        `${xs.length} edges, min gap ${minGap === Infinity ? "n/a" : minGap.toFixed(1)}px`,
      );
    }
  };
  sideAttach((e) => [e.source, e.sourceHandle ?? "b", (pos.get(e.source)?.x ?? 0) + (e.sourceOffset ?? 0)]);
  sideAttach((e) => [e.target, e.targetHandle ?? "t", (pos.get(e.target)?.x ?? 0) + (e.targetOffset ?? 0)]);

  // 3. gate attach points ride ON the diamond's 45° boundary (y-shift mirrors
  //    the x-shift) and quest attach points sit exactly on the horizontal
  //    borders — vertical entry/exit everywhere. Side-vertex tier chains
  //    anchor exactly at their handle (no spread offsets).
  for (const e of edges) {
    const s = pos.get(e.source);
    const t = pos.get(e.target);
    if (!s || !t) continue;
    const sideSource = e.sourceHandle === "s-right" || e.sourceHandle === "s-left";
    const sideTarget = e.targetHandle === "t-left" || e.targetHandle === "t-right";
    if (sideSource) {
      check(
        e.sourceOffset === undefined && e.sourceOffsetY === undefined,
        `${label}: side-source anchors at the handle (${e.id})`,
      );
    } else if (s.kind === "gate") {
      const want = e.sourceHandle === "t-up" ? Math.abs(e.sourceOffset ?? 0) : -Math.abs(e.sourceOffset ?? 0);
      check(
        e.sourceOffsetY === want,
        `${label}: gate source on slope (${e.id})`,
        `offset=${e.sourceOffset} offsetY=${e.sourceOffsetY}`,
      );
    } else {
      check(
        e.sourceOffsetY === undefined,
        `${label}: quest source on bottom border (${e.id})`,
        `offsetY=${e.sourceOffsetY}`,
      );
    }
    if (sideTarget) {
      check(
        e.targetOffset === undefined && e.targetOffsetY === undefined,
        `${label}: side-target anchors at the handle (${e.id})`,
      );
    } else if (t.kind === "gate") {
      check(
        e.targetOffsetY === Math.abs(e.targetOffset ?? 0),
        `${label}: gate target on upper slope (${e.id})`,
        `offset=${e.targetOffset} offsetY=${e.targetOffsetY}`,
      );
    } else {
      check(
        e.targetOffsetY === undefined,
        `${label}: quest target on top border (${e.id})`,
        `offsetY=${e.targetOffsetY}`,
      );
    }
  }

  // 3b. gates only ever touch quests they DIRECTLY gate: gate→quest edges must
  //     match the quest's own requirement at that level, and quest→gate edges
  //     may only be XP cascades (tier chains are strictly gate→gate)
  for (const e of edges) {
    if (e.source.startsWith("gate:") && !e.target.startsWith("gate:")) {
      const m = e.source.match(/^gate:([^:]+):(\d+)$/);
      const q = m ? QUEST_BY_KEY[e.target] : undefined;
      check(
        e.kind === "gate" && q?.skills[m![1]]?.level === Number(m![2]),
        `${label}: gate→quest edge is a direct requirement (${e.id})`,
      );
    }
    if (!e.source.startsWith("gate:") && e.target.startsWith("gate:")) {
      check(e.kind === "cascade", `${label}: quest→gate edge is a cascade (${e.id})`);
    }
    if (e.kind === "tier") {
      check(
        e.source.startsWith("gate:") && e.target.startsWith("gate:"),
        `${label}: tier chain is gate→gate (${e.id})`,
      );
      check(e.via === undefined || e.sourceHandle !== "s-right", `${label}: side tier not routed (${e.id})`);
    }
  }

  // 4. routed corridors sharing a vertical span keep CORRIDOR_SEP apart
  const routed = edges.filter((e) => e.via !== undefined);
  const spanOf = (e: LayoutEdge): [number, number] => {
    const sB = (pos.get(e.source)?.y ?? 0) + (e.source.startsWith("gate:") ? GATE_H : NODE_H);
    const tT = pos.get(e.target)?.y ?? 0;
    return [Math.min(sB, tT), Math.max(sB, tT)];
  };
  for (let i = 0; i < routed.length; i++) {
    for (let j = i + 1; j < routed.length; j++) {
      const [a0, a1] = spanOf(routed[i]);
      const [b0, b1] = spanOf(routed[j]);
      if (a0 < b1 - 6 && b0 < a1 - 6) {
        check(
          Math.abs((routed[i].via as number) - (routed[j].via as number)) >= CORRIDOR_SEP - 0.01,
          `${label}: corridors separated (${routed[i].id} vs ${routed[j].id})`,
          `${(routed[i].via ?? 0).toFixed(1)} vs ${(routed[j].via ?? 0).toFixed(1)}`,
        );
      }
    }
  }
  return routed.length;
}

/* -------- Scenario A: manual adds tier-chain a shared skill requirement --- */

console.log("Scenario A — Lunar Diplomacy + The Hand in the Sand added manually");
{
  const player = mkPlayer({ Crafting: 40 }); // everything else 99
  const { r, nodes, edges } = layoutFor(
    ["rune mysteries"],
    ["lunar diplomacy", "hand in sand"],
    player,
  );

  const gate49 = nodes.find((n) => n.kind === "gate" && n.id === "gate:Crafting:49");
  const gate61 = nodes.find((n) => n.kind === "gate" && n.id === "gate:Crafting:61");
  check(!!gate49, "Crafting 49 diamond exists (Hand in the Sand tier)");
  check(!!gate61, "Crafting 61 diamond exists (Lunar Diplomacy tier)");
  check(
    gate49?.kind === "gate" && gate49.fedCount === 1 && gate49.quest === "The Hand in the Sand",
    "49 diamond fed by The Hand in the Sand",
  );
  check(
    gate61?.kind === "gate" && gate61.fedCount === 1 && gate61.quest === "Lunar Diplomacy",
    "61 diamond fed by Lunar Diplomacy",
  );
  check(
    gate49?.kind === "gate" && gate49.xp > 0 && gate49.deficit === 9,
    "49 tier grind is its own (deficit 9)",
    gate49?.kind === "gate" ? `deficit=${gate49.deficit} xp=${gate49.xp}` : "",
  );
  const tierEdge = edges.find((e) => e.id === "tier:gate:Crafting:49->gate:Crafting:61");
  check(!!tierEdge, "tier-chain edge Crafting 49 diamond → Crafting 61 diamond");
  if (tierEdge) {
    const g49 = nodes.find((n) => n.id === "gate:Crafting:49");
    const g61 = nodes.find((n) => n.id === "gate:Crafting:61");
    const sameRow = Math.abs((g49?.y ?? 0) - (g61?.y ?? 1)) < 1;
    const sideHandles =
      tierEdge.sourceHandle === "s-right" || tierEdge.sourceHandle === "s-left";
    check(
      sameRow === sideHandles,
      "tier edge shape matches geometry (side-to-side on same row, vertical across rows)",
      `sameRow=${sameRow} handles=${tierEdge.sourceHandle}->${tierEdge.targetHandle}`,
    );
    check(
      !sameRow || (tierEdge.sourceOffset === undefined && tierEdge.targetOffset === undefined),
      "side-to-side tier anchors at the vertices (no offsets)",
    );
  }
  check(
    edges.some((e) => e.id === "gate:Crafting:49->hand in sand" && e.kind === "gate"),
    "gate edge Crafting 49 → Hand in the Sand",
  );
  check(
    edges.some((e) => e.id === "gate:Crafting:61->lunar diplomacy" && e.kind === "gate"),
    "gate edge Crafting 61 → Lunar Diplomacy",
  );
  // every cascade edge that exists must resolve to a real node (none expected
  // here: Hand's 9k Crafting XP doesn't clear its own raw-49 start gate)
  const cascades = edges.filter((e) => e.kind === "cascade");
  check(
    cascades.every((e) => nodes.some((n) => n.id === e.target)),
    "cascade edges resolve to real nodes",
    `${cascades.length} cascade edges`,
  );
  assertInvariants(nodes, edges, "A");
}

/* -------- Scenario B: XP cascade lands on the requirement's own diamond --- */

console.log("Scenario B — cascade attaches to the tier diamond it feeds");
{
  // Elemental Workshop II grants 7,500 Crafting XP with NO Crafting req —
  // from base 40 that crosses a boundary (the 40→41 gap is ~5.5k) but is
  // nowhere near Lunar Diplomacy's 61, so the cascade must land on the 61
  // diamond rather than the quest
  const base = 40;
  check(
    levelForXp(xpForLevel(base) + 7500) > base,
    `precondition: 7,500 XP crosses Crafting ${base}→${base + 1}`,
  );
  const player = mkPlayer({ Crafting: base });
  const { nodes, edges } = layoutFor(
    ["lunar diplomacy"],
    ["elemental workshop ii"],
    player,
  );

  check(
    !nodes.some((n) => n.id === "gate:Crafting:49"),
    "no 49 diamond without a 49 requirement",
  );
  check(
    nodes.some((n) => n.id === "gate:Crafting:61"),
    "Crafting 61 diamond exists",
  );
  const cascade = edges.find(
    (e) => e.kind === "cascade" && e.source === "elemental workshop ii",
  );
  check(
    cascade?.target === "gate:Crafting:61",
    "Elemental Workshop II XP cascades INTO the Crafting 61 diamond",
    cascade ? `→ ${cascade.target}` : "no cascade edge found",
  );
  assertInvariants(nodes, edges, "B");
}

/* -------- Scenario C: Quest Cape pseudo-target (crash regression) --------- */

console.log("Scenario C — Quest Cape full-board stress");
{
  // fresh account: every skill trains, so the whole board lights up
  const player = mkPlayer(Object.fromEntries([...SKILL_NAMES, "Combat"].map((s) => [s, 1])));
  player.combatLevel = 3;
  const { nodes, edges } = layoutFor(["__quest_cape__"], [], player);

  const cape = nodes.find((n) => n.id === "__quest_cape__");
  check(
    cape?.kind === "quest" && cape.quest.name === "Quest Cape",
    "cape node carries the synthetic quest (name readable)",
  );
  const routed = assertInvariants(nodes, edges, "C");
  const gateCount = nodes.filter((n) => n.kind === "gate").length;
  const tierEdges = edges.filter((e) => e.kind === "tier").length;
  console.log(
    `  board: ${nodes.length} nodes (${gateCount} gates), ${edges.length} edges, ${routed} routed, ${tierEdges} tier chains`,
  );
  check(gateCount > 50, "full board produces a dense gate set", `${gateCount} gates`);
  check(tierEdges > 20, "full board chains many skill tiers", `${tierEdges} tier edges`);

  // a known multi-tier skill: Cooking gates at many levels across the cape
  // plan — every tier diamond must be chained toward the next
  const cooking = nodes
    .filter((n) => n.kind === "gate" && n.skill === "Cooking")
    .map((n) => (n.kind === "gate" ? n.level : 0))
    .sort((a, b) => a - b);
  check(cooking.length >= 2, "Cooking tiers split into separate diamonds", cooking.join(","));
  for (let i = 0; i + 1 < cooking.length; i++) {
    check(
      edges.some(
        (e) =>
          e.kind === "tier" &&
          e.source === `gate:Cooking:${cooking[i]}` &&
          e.target === `gate:Cooking:${cooking[i + 1]}`,
      ),
      `Cooking ${cooking[i]} diamond chains to ${cooking[i + 1]} diamond`,
    );
  }
}

/* -------- summary -------------------------------------------------------- */

console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
if (failures > 0) process.exit(1);
