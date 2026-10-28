/**
 * Pure layout computation for the quest graph — no React, no React Flow.
 * Computes node positions (quest cards in odd rows, training-gate diamonds in
 * the even rows above the quests they gate) and every edge's attach geometry:
 * spread attach points on node borders, corridor x's for long routed edges.
 *
 * Separated from the component so harnesses can assert the geometry directly
 * (tools/verify-graph-layout.ts).
 */

import { QUEST_BY_KEY, QUEST_CAPE_QUEST, type Quest } from "./quest-data";
import type { ChainStep, SkillGap, TargetResult, XpCascade } from "./resolver";

/* -------------------------------------------------------------- constants */

export const NODE_W = 208; // px — must match the quest node's fixed width
export const NODE_H = 104; // px — estimated average quest node height for layout math
export const GATE_W = 118; // px — diamond gate container width
export const GATE_H = 88; // px — diamond gate container height
/* -----------------------------------------------------------------------
 * Spacing config — values picked against the layered-graph standards:
 *   ELK layered defaults  nodeNode 20 · nodeNodeBetweenLayers 20 · edgeNode 10
 *   dagre defaults        nodesep 50 · edgesep 10 · ranksep 50
 *   graphviz dot          nodesep 0.25in · ranksep 0.5in
 * This board is denser than the typical ELK input (208px cards), so the
 * gaps below sit between dagre's 50 and the card width; everything else
 * follows the same "spacing groups" idea — one knob per relationship.
 * ----------------------------------------------------------------------- */
const X_GAP = 72; // column gap between quest cards
const Y_GAP = 88; // row gap between quest rows
export const CORRIDOR_SEP = 34; // min separation between parallel routed corridors —
// wide enough that 9px edge-label pills on adjacent corridors don't collide
// (ELK edgeEdgeBetweenLayers 10 assumes unlabeled edges; labels need more)
// the diamond body is a 56px square rotated 45° — half its diagonal is how far
// its vertices reach from the container center
export const GATE_DIAMOND = 28 * Math.SQRT2; // ≈ 39.6px
const GATE_ATTACH_SPREAD = 36; // max horizontal attach distance from the diamond's vertical axis
// (kept ≤ GATE_DIAMOND so every attach point still rides ON the 45° slope)
const GATE_ATTACH_MIN = 18; // closest a slope attach point may sit to the vertex —
// interior points below this crowd the diamond tip and become unreadable
// the gate handles are pinned to the diamond's vertices (top-anchored,
// explicit size) so edge attach math is constant-driven — immune to measured height
export const GATE_HANDLE_Y = GATE_H / 2 + GATE_DIAMOND; // bottom vertex ≈ 83.6
export const GATE_TOP_Y = GATE_H / 2 - GATE_DIAMOND; // top vertex ≈ 4.4
/** vertical breathing room between an attach point and the edge's horizontal jog */
export const CLEARANCE = 14;

const ROW_H = NODE_H + Y_GAP;

// quests occupy odd rows (2L+1); training gates get the even rows (2L) so the
// two node kinds never share a row and every gate sits above its fed quests
export const questRowY = (layer: number) => (2 * layer + 1) * ROW_H;
export const gateRowY = (layer: number) => 2 * layer * ROW_H;

/**
 * Attach-point offsets for edges meeting a diamond's vertex, in ASCENDING
 * order (leftmost attach first). Evenly spaced along each 45° slope between
 * GATE_ATTACH_MIN and GATE_ATTACH_SPREAD; odd counts put the middle point
 * exactly on the vertex, where the tip is a clean unambiguous landing spot.
 *   k=1 → [0]                    k=4 → [-36, -18, 18, 36]
 *   k=2 → [-36, 36]              k=5 → [-36, -18, 0, 18, 36]
 *   k=3 → [-36, 0, 36]           k=6 → [-36, -27, -18, 18, 27, 36]
 */
function vertexAttachOffsets(k: number): number[] {
  if (k <= 1) return [0];
  const perSide = Math.floor(k / 2);
  const side = (n: number) =>
    n === 1
      ? [GATE_ATTACH_SPREAD]
      : Array.from(
          { length: n },
          (_, i) => GATE_ATTACH_MIN + ((GATE_ATTACH_SPREAD - GATE_ATTACH_MIN) * i) / (n - 1),
        );
  const right = side(perSide);
  const left = [...side(perSide)].reverse().map((v) => -v); // ascending negatives
  return [...left, ...(k % 2 ? [0] : []), ...right];
}

/* ----------------------------------------------------------------- types */

export type EdgeKind =
  | "gate" // diamond → quest it blocks (train this first)
  | "tier" // quest fed by a lower tier → the next tier's diamond (skill ladder)
  | "prereq" // quest → quest prerequisite
  | "target" // prereq edge entering a tracked target (emphasized)
  | "cascade"; // quest-XP grant → node it pushes a level toward

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** px shift from the source's bottom-center attach point */
  sourceOffset?: number;
  /** px shift from the target's top-center attach point */
  targetOffset?: number;
  /** px vertical attach shift (gates: attach ON the diamond's boundary) */
  sourceOffsetY?: number;
  targetOffsetY?: number;
  /** explicit React Flow handle ids (gate side/top-vertex exits; undefined = default handle) */
  sourceHandle?: string;
  targetHandle?: string;
  /** corridor x the long vertical run is displaced to (routed edges) */
  via?: number;
  /** small edge label (XP cascades) */
  label?: string;
}

export interface QuestLayoutNode {
  id: string;
  kind: "quest";
  x: number;
  y: number;
  quest: Quest;
  isTarget: boolean;
  isExtra: boolean;
}

/**
 * One training-gate diamond per (skill, level) requirement — NOT one per
 * skill: a plan that needs Crafting 49 before one quest and 61 before another
 * gets two diamonds, chained by tier edges, so each requirement reads as its
 * own step in the plan.
 */
export interface GateLayoutNode {
  id: string; // `gate:${skill}:${level}`
  kind: "gate";
  x: number;
  y: number;
  skill: string;
  level: number;
  quest: string; // first quest (plan order) that needs this level
  toStart: boolean; // that quest requires the level to START
  deficit: number; // levels to train for this tier (worst gap among its quests)
  xp: number; // raw xp for this tier's worst gap
  fedCount: number; // quests in the plan needing exactly this level
}

export type LayoutNode = QuestLayoutNode | GateLayoutNode;

interface GateLayout {
  id: string; // `gate:${skill}:${level}` — one diamond per requirement tier
  skill: string;
  level: number;
  gap: SkillGap; // representative gap (worst deficit among the tier's quests)
  fed: string[]; // quest keys needing exactly this level, chain order
}

/* ---------------------------------------------------------------- layout */

export function computeLayout(
  steps: ChainStep[],
  targets: TargetResult[],
  cascades: XpCascade[],
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const order = new Map<string, number>(
    steps.map((s, i) => [s.quest.key, i] as const),
  );
  targets.forEach((t, i) => {
    if (!order.has(t.quest.key)) order.set(t.quest.key, steps.length + i);
  });
  const inPlan = new Set(order.keys());
  const targetKeySet = new Set(targets.map((t) => t.quest.key));

  // prerequisite edges confined to the plan (both endpoints present, deduped)
  const parentsOf = new Map<string, string[]>();
  for (const key of inPlan) {
    const q = QUEST_BY_KEY[key];
    const ps = (q?.quests ?? []).filter((p) => inPlan.has(p) && p !== key);
    parentsOf.set(key, [...new Set(ps)]);
  }

  // longest-path layering over the plan subgraph (memoized DFS; the graph is a DAG)
  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (key: string): number => {
    const memo = layerOf.get(key);
    if (memo !== undefined) return memo;
    if (visiting.has(key)) return 0; // cycle guard — data is acyclic
    visiting.add(key);
    let layer = 0;
    for (const p of parentsOf.get(key) ?? []) layer = Math.max(layer, depth(p) + 1);
    visiting.delete(key);
    layerOf.set(key, layer);
    return layer;
  };
  for (const key of inPlan) depth(key);

  // ---- training gates: ONE diamond per (skill, level) that still needs real
  // training somewhere in the plan (boost-ok / quest-xp-covered gaps are not
  // gates). A skill gated at several levels becomes a ladder of diamonds.
  const gates = new Map<string, GateLayout>();
  const feed = (gap: SkillGap, questKey: string) => {
    if (gap.status !== "train") return;
    const id = `gate:${gap.skill}:${gap.required}`;
    let g = gates.get(id);
    if (!g) {
      g = { id, skill: gap.skill, level: gap.required, gap, fed: [] };
      gates.set(id, g);
    }
    // a tracked target that is also another target's prerequisite appears BOTH
    // as a plan step and as a target — feed it once (the step entry is the
    // authoritative one: its gaps reflect XP accrued up to that chain point)
    if (!g.fed.includes(questKey)) g.fed.push(questKey);
    if (gap.deficit > g.gap.deficit) g.gap = gap; // worst grind represents the tier
  };
  const fedKeys = new Set<string>();
  for (const s of steps) {
    fedKeys.add(s.quest.key);
    for (const gap of s.gaps) feed(gap, s.quest.key);
  }
  for (const t of targets) {
    if (fedKeys.has(t.quest.key)) continue; // already fed via its step entry
    for (const gap of t.gaps) feed(gap, t.quest.key);
  }

  // ---- positions
  const pos = new Map<string, { x: number; y: number }>();

  // quests: group by layer; initial order = optimal chain position, then a few
  // barycenter sweeps (down/up over adjacent layers) to cut edge crossings
  const layers = new Map<number, string[]>();
  for (const key of [...inPlan].sort((a, b) => order.get(a)! - order.get(b)!)) {
    const l = layerOf.get(key)!;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(key);
  }

  // inverse of parentsOf (in-plan only)
  const childrenOf = new Map<string, string[]>();
  for (const [key, ps] of parentsOf) {
    for (const p of ps) {
      const arr = childrenOf.get(p);
      if (arr) arr.push(key);
      else childrenOf.set(p, [key]);
    }
  }

  const orderIn = new Map<string, number>();
  for (const [, keys] of layers) keys.forEach((k, i) => orderIn.set(k, i));
  const layerNums = [...layers.keys()].sort((a, b) => a - b);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const seq = down ? layerNums : [...layerNums].reverse();
    for (const l of seq) {
      const keys = layers.get(l)!;
      const neighbor = down ? parentsOf : childrenOf;
      const adjLayer = l + (down ? -1 : 1);
      const scored = keys.map((k, i) => {
        const nb = (neighbor.get(k) ?? []).filter((n) => layerOf.get(n) === adjLayer);
        const bary = nb.length
          ? nb.reduce((a, n) => a + (orderIn.get(n) ?? 0), 0) / nb.length
          : i;
        return { k, bary, tie: i };
      });
      scored.sort((a, b) => a.bary - b.bary || a.tie - b.tie);
      scored.forEach((e, i) => {
        keys[i] = e.k;
        orderIn.set(e.k, i);
      });
    }
  }

  for (const [layer, keys] of layers) {
    keys.forEach((key, i) => {
      pos.set(key, {
        x: (i - (keys.length - 1) / 2) * (NODE_W + X_GAP),
        y: questRowY(layer),
      });
    });
  }

  // gates: own row above the earliest quest they feed, x tracks the mean of
  // the fed quests' x; collisions inside a row resolved left->right, then the
  // row is re-centered so it visually hugs the quests it feeds
  const gateRows = new Map<number, GateLayout[]>();
  for (const g of gates.values()) {
    const minLayer = Math.min(...g.fed.map((f) => layerOf.get(f) ?? 0));
    const row = 2 * minLayer;
    const arr = gateRows.get(row);
    if (arr) arr.push(g);
    else gateRows.set(row, [g]);
  }
  const MIN_GATE_SPACING = GATE_W + 30;
  for (const [row, rowGates] of gateRows) {
    const desired = rowGates.map((g) => {
      const xs = g.fed.map((f) => pos.get(f)?.x ?? 0);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    });
    const idx = rowGates.map((_, i) => i).sort((a, b) => desired[a] - desired[b]);
    const placedX: number[] = new Array(rowGates.length);
    let prev = -Infinity;
    for (const i of idx) {
      placedX[i] = Math.max(desired[i], prev + MIN_GATE_SPACING);
      prev = placedX[i];
    }
    const desiredMean = desired.reduce((a, b) => a + b, 0) / desired.length;
    const placedMean = placedX.reduce((a, b) => a + b, 0) / placedX.length;
    const shift = desiredMean - placedMean;
    rowGates.forEach((g, i) => {
      pos.set(g.id, { x: placedX[i] + shift, y: gateRowY(row / 2) });
    });
  }

  // ---- nodes
  const stepByKey = new Map(steps.map((s) => [s.quest.key, s] as const));
  const nodes: LayoutNode[] = [];
  for (const key of [...inPlan].sort((a, b) => order.get(a)! - order.get(b)!)) {
    const p = pos.get(key)!;
    nodes.push({
      id: key,
      kind: "quest",
      x: p.x,
      y: p.y,
      // cape target is a synthetic quest with no dataset entry — fall back or
      // the node crashes the board reading `quest.name`
      quest: stepByKey.get(key)?.quest ?? QUEST_BY_KEY[key] ?? QUEST_CAPE_QUEST,
      isTarget: targetKeySet.has(key),
      isExtra: stepByKey.get(key)?.isExtra ?? false,
    });
  }
  for (const g of gates.values()) {
    const p = pos.get(g.id)!;
    nodes.push({
      id: g.id,
      kind: "gate",
      x: p.x,
      y: p.y,
      skill: g.skill,
      level: g.level,
      quest: QUEST_BY_KEY[g.fed[0]]?.name ?? g.fed[0],
      toStart: g.gap.requiredToStart,
      deficit: g.gap.deficit,
      xp: g.gap.xpNeeded,
      fedCount: g.fed.length,
    });
  }

  // ---- edges (gate edges first so they render beneath prereq edges)
  const edges: LayoutEdge[] = [];
  for (const g of gates.values()) {
    for (const f of g.fed) {
      edges.push({ id: `${g.id}->${f}`, source: g.id, target: f, kind: "gate" });
    }
  }

  // tier-chain edges: a skill training through several levels in one plan
  // (49 before one quest, 61 before another) reads as a LADDER of diamonds —
  // each tier's gate connects to the next tier's gate, never to a quest it
  // doesn't directly require. Gates share a row connect side-to-side at the
  // side vertices; gates in different rows connect through the vertical
  // vertices (bottom exit downward, top exit upward).
  const tiersBySkill = new Map<string, GateLayout[]>();
  for (const g of gates.values()) {
    const arr = tiersBySkill.get(g.skill);
    if (arr) arr.push(g);
    else tiersBySkill.set(g.skill, [g]);
  }
  for (const arr of tiersBySkill.values()) {
    arr.sort((a, b) => a.level - b.level);
    for (let i = 0; i + 1 < arr.length; i++) {
      const lower = arr[i];
      const next = arr[i + 1];
      const lp = pos.get(lower.id) ?? { x: 0, y: 0 };
      const np = pos.get(next.id) ?? { x: 0, y: 0 };
      const e: LayoutEdge = {
        id: `tier:${lower.id}->${next.id}`,
        source: lower.id,
        target: next.id,
        kind: "tier",
      };
      if (Math.abs(lp.y - np.y) < 1) {
        // same gate row: straight side-to-side line between the diamonds
        if (np.x >= lp.x) {
          e.sourceHandle = "s-right";
          e.targetHandle = "t-left";
        } else {
          e.sourceHandle = "s-left";
          e.targetHandle = "t-right";
        }
      } else if (np.y < lp.y) {
        // next tier's gate sits higher on the board: leave via the top vertex
        e.sourceHandle = "t-up";
      }
      // else: next tier sits lower — default handles (bottom → top vertex)
      edges.push(e);
    }
  }

  for (const key of inPlan) {
    for (const p of parentsOf.get(key) ?? []) {
      edges.push({
        id: `${p}->${key}`,
        source: p,
        target: key,
        kind: targetKeySet.has(key) ? "target" : "prereq",
      });
    }
  }

  // XP-cascade edges: dotted red lines from an XP grant down to the next
  // node in the same skill (the quest itself when the level-up completes it,
  // otherwise that requirement's own tier diamond)
  for (const c of cascades) {
    const toId = c.toGate ? `gate:${c.skill}:${c.toLevel}` : c.toQuest;
    if (!pos.has(c.from) || !pos.has(toId)) continue; // defensive — both endpoints must exist
    edges.push({
      id: `xp:${c.from}->${toId}:${c.skill}`,
      source: c.from,
      target: toId,
      kind: "cascade",
      // boundary-crossing grants show the level jump; own-gate-floored grants
      // (no crossing possible) show the raw xp added
      label:
        c.levelFrom === c.levelTo
          ? `${c.skill} +${c.xpGain.toLocaleString("en-US")}`
          : `${c.skill} ${c.levelFrom}→${c.levelTo}`,
    });
  }

  // ---- spread anchors: every edge end gets its own attach point so lines
  // never overlap where they meet a node
  const posOf = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const spread = (n: number, span: number): number[] =>
    n <= 1 ? [0] : Array.from({ length: n }, (_, i) => -span + (2 * span * i) / (n - 1));

  const byTarget = new Map<string, LayoutEdge[]>();
  const bySource = new Map<string, LayoutEdge[]>();
  for (const e of edges) {
    const t = byTarget.get(e.target);
    if (t) t.push(e);
    else byTarget.set(e.target, [e]);
    const s = bySource.get(e.source);
    if (s) s.push(e);
    else bySource.set(e.source, [e]);
  }
  // side-vertex edges (same-row tier chains) anchor exactly at their handle —
  // they must not be pulled into the vertex spreads below
  const isSideTarget = (e: LayoutEdge) => e.targetHandle === "t-left" || e.targetHandle === "t-right";
  const isSideSource = (e: LayoutEdge) => e.sourceHandle === "s-right" || e.sourceHandle === "s-left";
  for (const [tid, arr] of byTarget) {
    const vEdges = arr.filter((e) => !isSideTarget(e));
    vEdges.sort(
      (a, b) => posOf(a.source).x - posOf(b.source).x || posOf(a.source).y - posOf(b.source).y,
    );
    if (tid.startsWith("gate:")) {
      // Diamond targets (tier chains + XP cascades): the quest-card spread below would
      // leave the endpoints floating in thin air beside the diamond's sloped upper
      // edges. Attach ON the upper boundary instead — leftmost source connects
      // on the upper-left edge, rightmost on the upper-right, a single edge
      // lands exactly on the top vertex (mirrors the gate source branch).
      const offs = vertexAttachOffsets(vEdges.length); // ascending — matches the source-x sort
      vEdges.forEach((e, i) => {
        const dx = offs[i];
        // handle sits on the top vertex; walking |dx| along the 45° upper
        // edges DROPS the attach point onto the diamond boundary (y grows)
        e.targetOffset = dx;
        e.targetOffsetY = Math.abs(dx);
      });
      continue;
    }
    const offs = spread(vEdges.length, 0.36 * NODE_W); // targets are always quest cards
    vEdges.forEach((e, i) => {
      e.targetOffset = offs[i];
    });
  }
  for (const [sid, arr] of bySource) {
    const vEdges = arr.filter((e) => !isSideSource(e));
    vEdges.sort(
      (a, b) => posOf(a.target).x - posOf(b.target).x || posOf(a.target).y - posOf(b.target).y,
    );
    if (sid.startsWith("gate:")) {
      // Diamonds: a square-style horizontal spread at the container bottom
      // leaves the line endpoints floating in thin air beside the sloped
      // edges. Attach every edge ON the diamond's boundary instead — downward
      // edges (default handle) ride the lower slopes from the bottom vertex;
      // upward tier chains ("t-up" handle) ride the upper slopes from the
      // top vertex.
      const downEdges = vEdges.filter((e) => e.sourceHandle !== "t-up");
      const upEdges = vEdges.filter((e) => e.sourceHandle === "t-up");
      const dOffs = vertexAttachOffsets(downEdges.length); // ascending — matches the sort
      downEdges.forEach((e, i) => {
        const dx = dOffs[i];
        // handle sits exactly on the diamond's bottom vertex; walking |dx| along
        // the 45° lower edges rises the attach point by the same amount
        e.sourceOffset = dx;
        e.sourceOffsetY = -Math.abs(dx);
      });
      const uOffs = vertexAttachOffsets(upEdges.length);
      upEdges.forEach((e, i) => {
        const dx = uOffs[i];
        // mirror image: from the top vertex, walking |dx| along the upper
        // edges DROPS the attach point onto the boundary
        e.sourceOffset = dx;
        e.sourceOffsetY = Math.abs(dx);
      });
      continue;
    }
    const span = 0.36 * NODE_W; // quest cards: spread across the bottom edge
    const offs = spread(vEdges.length, span);
    vEdges.forEach((e, i) => {
      e.sourceOffset = offs[i];
    });
  }

  // ---- long-edge corridor routing: an edge whose vertical run would cross
  // other node rectangles gets displaced to a free corridor x in the gaps
  // between columns, so lines stop running behind quest cards and gates.
  const halfW = (id: string) => (id.startsWith("gate:") ? GATE_W / 2 : NODE_W / 2);
  const boxH = (id: string) => (id.startsWith("gate:") ? GATE_H : NODE_H);
  const rects = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  for (const [id, p] of pos) {
    const w = halfW(id);
    rects.set(id, { x0: p.x - w, x1: p.x + w, y0: p.y, y1: p.y + boxH(id) });
  }

  const usedCorridors: { x: number; y0: number; y1: number }[] = [];
  const routeEdge = (e: LayoutEdge, sx: number, tx: number, sBottom: number, tTop: number) => {
    // vertical span between the two attach rows (upward edges invert the
    // source/target order — normalize so blocked-rect and overlap tests work
    // in both directions)
    const span0 = Math.min(sBottom, tTop);
    const span1 = Math.max(sBottom, tTop);
    const blocked: [number, number][] = [];
    for (const [id, r] of rects) {
      if (id === e.source || id === e.target) continue;
      if (r.y1 > span0 + 4 && r.y0 < span1 - 4) blocked.push([r.x0 - 6, r.x1 + 6]);
    }
    if (blocked.length === 0) return; // clear vertical run — direct path is fine
    blocked.sort((a, b) => a[0] - b[0]);
    // free x-intervals around the blocked columns, with outer margins
    const lo = Math.min(blocked[0][0], sx, tx) - 90;
    const hi = Math.max(blocked[blocked.length - 1][1], sx, tx) + 90;
    const free: [number, number][] = [];
    let cur = lo;
    for (const [b0, b1] of blocked) {
      if (b0 - cur > 24) free.push([cur, b0]);
      cur = Math.max(cur, b1);
    }
    if (hi - cur > 24) free.push([cur, hi]);
    const desired = (sx + tx) / 2;
    const scored = free
      .map(([a, b]) => {
        const x = Math.min(Math.max(desired, a + 10), b - 10);
        // prefer intervals with fewer corridors that vertically overlap this edge
        const occupancy = usedCorridors.filter(
          (u) => u.x >= a && u.x <= b && u.y0 < span1 - 6 && u.y1 > span0 + 6,
        ).length;
        return { a, b, x, key: Math.abs(x - desired) + occupancy * 46 };
      })
      .sort((p, q) => p.key - q.key);
    for (const iv of scored) {
      // walk outward in CORRIDOR_SEP px steps until the corridor does not
      // clash with another routed edge sharing this vertical span
      const maxStep = Math.ceil((iv.b - iv.a) / CORRIDOR_SEP);
      const cands: number[] = [];
      for (let step = 0; step <= maxStep; step++) {
        for (const cand of step === 0 ? [iv.x] : [iv.x + step * CORRIDOR_SEP, iv.x - step * CORRIDOR_SEP]) {
          if (cand >= iv.a + 10 && cand <= iv.b - 10) cands.push(cand);
        }
      }
      for (const x of cands) {
        const clash = usedCorridors.some(
          (u) => Math.abs(u.x - x) < CORRIDOR_SEP && u.y0 < span1 - 6 && u.y1 > span0 + 6,
        );
        if (!clash) {
          usedCorridors.push({ x, y0: span0, y1: span1 });
          e.via = x;
          return;
        }
      }
    }
    // nowhere clean — leave direct (rare)
  };

  for (const e of edges) {
    if (isSideSource(e)) continue; // horizontal side-vertex lines need no corridor
    const sp = posOf(e.source);
    const tp = posOf(e.target);
    const sBottom = sp.y + boxH(e.source);
    const tTop = tp.y;
    routeEdge(e, sp.x + (e.sourceOffset ?? 0), tp.x + (e.targetOffset ?? 0), sBottom, tTop);
  }

  return { nodes, edges };
}
