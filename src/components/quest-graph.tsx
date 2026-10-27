"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  getViewportForBounds,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { Camera, Dumbbell, ExternalLink, Filter, Loader2, Plus } from "lucide-react";

import { TOOLTIP_ARROW, TOOLTIP_BOX, skillSuggestAnchorId } from "@/components/skill-panels";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { QUEST_BY_KEY, Quest } from "@/lib/quest-data";
import type { ChainStep, SkillGap } from "@/lib/resolver";

/* -------------------------------------------------------------- constants */

const NODE_W = 208; // px — must match the quest node's fixed width
const NODE_H = 104; // px — estimated average quest node height for layout math
const GATE_W = 118; // px — diamond gate container width
const GATE_H = 88; // px — diamond gate container height
// the diamond body is a 56px square rotated 45° — half its diagonal is how far
// its vertices reach from the container center
const GATE_DIAMOND = 28 * Math.SQRT2; // ≈ 39.6px
const GATE_ATTACH_SPREAD = 24; // max horizontal attach distance from the diamond's vertical axis
// the gate's source handle is pinned to the diamond's bottom vertex (top-anchored,
// explicit size) so edge attach math is constant-driven — immune to measured height
const GATE_HANDLE_Y = GATE_H / 2 + GATE_DIAMOND; // vertex offset from node top ≈ 83.6
const X_GAP = 72;
const Y_GAP = 88;
const ROW_H = NODE_H + Y_GAP;

// quests occupy odd rows (2L+1); training gates get the even rows (2L) so the
// two node kinds never share a row and every gate sits above its fed quests
const questRowY = (layer: number) => (2 * layer + 1) * ROW_H;
const gateRowY = (layer: number) => 2 * layer * ROW_H;

const PREREQ_STROKE = "#57534e";
const TARGET_STROKE = "#d97706";
const GATE_STROKE = "#dc2626";

const DIFF_DOT: Record<string, string> = {
  Novice: "bg-emerald-500",
  Intermediate: "bg-amber-500",
  Experienced: "bg-orange-500",
  Master: "bg-rose-500",
  Grandmaster: "bg-red-500",
  Special: "bg-purple-500",
  Miniquest: "bg-teal-500",
  Activity: "bg-stone-500",
  Unknown: "bg-stone-500",
};

function wikiUrl(name: string) {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(name)
    .replace(/%2F/g, "/")
    .replace(/%20/g, "_")}`;
}

/** Wiki guide for raising a skill ("Combat" has no skill-training article). */
function skillGuideUrl(skill: string) {
  return wikiUrl(skill === "Combat" ? "Combat" : `${skill} training`);
}

/* ------------------------------------------------------------ graph nodes */

export type QuestNodeData = {
  quest: Quest;
  done: boolean;
  isExtra: boolean;
  isTarget: boolean;
  onToggle: (key: string) => void;
};

export type GateNodeData = {
  skill: string;
  level: number;
  deficit: number; // levels to raise (worst gap among fed quests)
  xpNeeded: number; // raw xp for the worst gap
  fedCount: number; // how many in-plan quests need this exact level
  firstName: string; // earliest plan quest that needs it
  firstToStart: boolean; // earliest fed quest requires the level to START (vs to complete)
  onFindSkill?: (skill: string) => void; // hover "+" → jump to the skill's quest suggestions
};

type QuestFlowNode = Node<QuestNodeData, "quest">;
type GateFlowNode = Node<GateNodeData, "gate">;
type FlowNode = QuestFlowNode | GateFlowNode;

function QuestNode({ data, selected }: NodeProps<QuestFlowNode>) {
  const { quest, done, isExtra, isTarget, onToggle } = data;
  return (
    <div
      className={`w-[208px] rounded-lg border bg-stone-900/95 px-2.5 py-2 shadow-md transition-shadow ${
        isTarget
          ? "border-amber-600 shadow-[0_0_14px_rgba(217,119,6,0.35)]"
          : done
            ? "border-emerald-800/70"
            : isExtra
              ? "border-sky-800/70"
              : "border-stone-700"
      } ${selected ? "ring-1 ring-amber-500/70" : ""} ${done && !isTarget ? "opacity-70" : ""}`}
    >
      {/* handles are structural only — edges anchor to spread points on the border */}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-start justify-between gap-1.5">
        <a
          href={wikiUrl(quest.name)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`text-[11px] font-semibold leading-snug hover:text-amber-300 hover:underline ${
            done ? "text-stone-500 line-through" : isTarget ? "text-amber-200" : "text-stone-100"
          }`}
        >
          {quest.name}
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(quest.key);
          }}
          aria-label={done ? `Mark ${quest.name} not complete` : `Mark ${quest.name} complete`}
          className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] leading-none transition-colors ${
            done
              ? "border-emerald-600 bg-emerald-700 text-stone-50"
              : "border-stone-600 text-transparent hover:border-emerald-500 hover:text-emerald-400/60"
          }`}
        >
          ✓
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center gap-1 text-[9px] text-stone-400">
          <span className={`h-1.5 w-1.5 rounded-full ${DIFF_DOT[quest.difficulty] ?? "bg-stone-500"}`} />
          {quest.difficulty}
        </span>
        {isTarget && (
          <span className="rounded border border-amber-700/60 bg-amber-950/50 px-1 text-[8px] font-medium uppercase tracking-wide text-amber-300">
            target
          </span>
        )}
        {isExtra && (
          <span className="rounded border border-sky-800/60 bg-sky-950/40 px-1 text-[8px] font-medium text-sky-300">
            added for XP
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

function GateNode({ data }: NodeProps<GateFlowNode>) {
  const { skill, level, deficit, xpNeeded, fedCount, firstName, firstToStart, onFindSkill } = data;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="group relative grid h-[88px] w-[118px] cursor-default place-items-center"
          role="img"
          aria-label={`Training gate: raise ${skill} to level ${level}`}
        >
          {onFindSkill && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFindSkill(skill);
              }}
              aria-label={`Show quest suggestions for raising ${skill}`}
              title={`Jump to ${skill} quest suggestions below the plan`}
              className="absolute left-1/2 top-0 z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-amber-600/80 bg-stone-950 text-amber-300 opacity-0 shadow-md transition-opacity duration-150 hover:bg-stone-900 hover:text-amber-100 focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
            >
              <Plus className="h-3 w-3" aria-hidden />
            </button>
          )}
          {/* rotated square = diamond body; content stays unrotated on top */}
          <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[5px] border border-red-700/80 bg-gradient-to-br from-red-950/95 to-stone-950/95 shadow-[0_0_12px_rgba(220,38,38,0.28)]" />
          <div className="relative flex flex-col items-center leading-none">
            <Dumbbell className="mb-1 h-3 w-3 text-red-400" aria-hidden />
            <span className="max-w-[94px] truncate text-[10px] font-semibold tracking-wide text-red-200">
              {skill}
            </span>
            <span className="mt-0.5 text-[12px] font-bold tabular-nums text-red-50">{level}</span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={10}
        arrowClassName={TOOLTIP_ARROW}
        className={`max-w-[260px] px-3 py-2.5 leading-relaxed ${TOOLTIP_BOX}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-300 pb-1.5">
          <span className="text-xs font-semibold text-stone-900">
            <a
              href={skillGuideUrl(skill)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline decoration-stone-400 underline-offset-2 hover:decoration-red-700 hover:text-red-800"
            >
              {skill}
            </a>{" "}
            <span className="text-stone-500">→</span> level {level}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-red-700">train</span>
        </div>
        <p className="mt-1.5 text-xs text-stone-700">
          Raise <b className="font-semibold text-stone-900">{skill}</b> by{" "}
          <b className="font-semibold text-stone-900">{deficit}</b> level{deficit === 1 ? "" : "s"} (≈{" "}
          <b className="font-semibold text-stone-900">{xpNeeded.toLocaleString("en-US")}</b> XP) before{" "}
          {firstToStart ? "starting" : "completing"}{" "}
          <a
            href={wikiUrl(firstName)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-stone-900 underline decoration-stone-400 underline-offset-2 hover:decoration-red-700 hover:text-red-800"
          >
            {firstName}
          </a>
          .
        </p>
        {fedCount > 1 && (
          <p className="mt-1 text-[11px] text-stone-600">
            This level also covers {fedCount - 1} other quest{fedCount === 2 ? "" : "s"} in the plan.
          </p>
        )}
        <a
          href={skillGuideUrl(skill)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-1.5 inline-flex items-center gap-1 border-t border-stone-300 pt-1.5 text-[11px] font-medium text-amber-800 hover:text-amber-950 hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          {skill === "Combat" ? "Combat guide" : `${skill} training guide`}
        </a>
      </TooltipContent>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!opacity-0"
        style={{
          // RF anchors Bottom handles at handle.y + FULL height (not the
          // center) — so top = vertexY - handleHeight pins the anchor to the
          // diamond's bottom vertex regardless of measured container height
          top: GATE_HANDLE_Y - 6,
          bottom: "auto",
          width: 6,
          height: 6,
          transform: "translate(-50%, 0)", // kill RF's default 50% y-shift
        }}
      />
    </Tooltip>
  );
}

const NODE_TYPES = { quest: QuestNode, gate: GateNode };

/* ---------------------------------------------------------------- edges */

type SpreadEdgeData = {
  sourceOffset?: number; // px shift from bottom-center attach point
  targetOffset?: number; // px shift from top-center attach point
  sourceOffsetY?: number; // px vertical shift (gates: attach ON the diamond)
  targetOffsetY?: number;
  turn?: number; // smoothstep turn distance
};

/**
 * Smoothstep edge whose attach points are spread across the node borders.
 * Multiple edges sharing a node no longer overlap: the layout precomputes a
 * distinct horizontal offset for every edge end (`data.sourceOffset` /
 * `data.targetOffset`), so each line terminates at its own point.
 */
function SpreadEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as SpreadEdgeData;
  const [edgePath] = getSmoothStepPath({
    sourceX: sourceX + (d.sourceOffset ?? 0),
    sourceY: sourceY + (d.sourceOffsetY ?? 0),
    sourcePosition,
    targetX: targetX + (d.targetOffset ?? 0),
    targetY: targetY + (d.targetOffsetY ?? 0),
    targetPosition,
    borderRadius: 12,
    offset: d.turn ?? 24,
  });
  return <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />;
}

const EDGE_TYPES = { spread: SpreadEdge, routed: RoutedEdge };

/* ---------------------------------------------------------------- edges */

type RoutedEdgeData = {
  sourceOffset?: number;
  targetOffset?: number;
  sourceOffsetY?: number;
  targetOffsetY?: number;
  via?: number; // corridor x the long vertical run is displaced to
};

/** SVG path through waypoints with rounded corners; zero-length runs are dropped. */
function roundedPath(pts: [number, number][], r: number): string {
  const clean: [number, number][] = [];
  for (const p of pts) {
    const q = clean[clean.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 0.5 || Math.abs(q[1] - p[1]) > 0.5) clean.push(p);
  }
  if (clean.length < 2) return "";
  let d = `M ${clean[0][0]} ${clean[0][1]}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const [x0, y0] = clean[i - 1];
    const [x1, y1] = clean[i];
    const [x2, y2] = clean[i + 1];
    const d1 = Math.hypot(x1 - x0, y1 - y0) || 1;
    const d2 = Math.hypot(x2 - x1, y2 - y1) || 1;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    d += ` L ${x1 - ((x1 - x0) / d1) * rr} ${y1 - ((y1 - y0) / d1) * rr}`;
    d += ` Q ${x1} ${y1} ${x1 + ((x2 - x1) / d2) * rr} ${y1 + ((y2 - y1) / d2) * rr}`;
  }
  const last = clean[clean.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

/**
 * Long-distance edge: a plain smoothstep's vertical run would cut straight
 * through whatever rows sit between source and target. This edge displaces
 * the run to a precomputed corridor x (`data.via`) chosen in the gaps between
 * node columns, so lines stop running behind quest cards.
 */
function RoutedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as RoutedEdgeData;
  const sx = sourceX + (d.sourceOffset ?? 0);
  const tx = targetX + (d.targetOffset ?? 0);
  const sy = sourceY + (d.sourceOffsetY ?? 0);
  const ty = targetY + (d.targetOffsetY ?? 0);
  const via = d.via ?? (sx + tx) / 2;
  const path = roundedPath(
    [
      [sx, sy],
      [sx, sy + 16],
      [via, sy + 16],
      [via, ty - 16],
      [tx, ty - 16],
      [tx, ty],
    ],
    12,
  );
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}

/* ---------------------------------------------------------------- layout */

/** Bounding rect of the given nodes (measured sizes, top-left positions). */
function graphBounds(nodes: { position: { x: number; y: number }; measured?: { width?: number | null; height?: number | null }; type?: string }[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    const w = n.measured?.width ?? (n.type === "gate" ? GATE_W : NODE_W);
    const h = n.measured?.height ?? (n.type === "gate" ? GATE_H : NODE_H);
    x0 = Math.min(x0, n.position.x);
    y0 = Math.min(y0, n.position.y);
    x1 = Math.max(x1, n.position.x + w);
    y1 = Math.max(y1, n.position.y + h);
  }
  if (x0 === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

interface GateInfo {
  id: string; // `gate:${skill}:${level}`
  skill: string;
  level: number;
  gap: SkillGap; // worst (largest deficit) gap among fed quests
  fed: string[]; // plan quest keys needing this exact level, in chain order
  firstToStart: boolean; // earliest fed quest gates on START vs COMPLETE
}

function computeLayout(
  steps: ChainStep[],
  target: Quest,
  targetGaps: SkillGap[],
): { nodes: FlowNode[]; edges: Edge[] } {
  const order = new Map<string, number>(
    steps.map((s, i) => [s.quest.key, i] as const),
  );
  order.set(target.key, steps.length);
  const inPlan = new Set(order.keys());

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

  // ---- training gates: one diamond per (skill, level) that still needs real
  // training somewhere in the plan (boost-ok / quest-xp-covered gaps are not gates)
  const gates = new Map<string, GateInfo>();
  const feed = (gap: SkillGap, questKey: string) => {
    if (gap.status !== "train") return;
    const id = `gate:${gap.skill}:${gap.required}`;
    const g = gates.get(id);
    if (g) {
      g.fed.push(questKey);
      if (gap.deficit > g.gap.deficit) g.gap = gap;
    } else {
      gates.set(id, {
        id,
        skill: gap.skill,
        level: gap.required,
        gap,
        fed: [questKey],
        firstToStart: gap.requiredToStart,
      });
    }
  };
  for (const s of steps) for (const gap of s.gaps) feed(gap, s.quest.key);
  for (const gap of targetGaps) feed(gap, target.key);

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
  const gateRows = new Map<number, GateInfo[]>();
  for (const g of gates.values()) {
    const minLayer = Math.min(...g.fed.map((k) => layerOf.get(k) ?? 0));
    const row = 2 * minLayer;
    const arr = gateRows.get(row);
    if (arr) arr.push(g);
    else gateRows.set(row, [g]);
  }
  const MIN_GATE_SPACING = GATE_W + 30;
  for (const [row, rowGates] of gateRows) {
    const desired = rowGates.map((g) => {
      const xs = g.fed.map((k) => pos.get(k)?.x ?? 0);
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
  const nodes: FlowNode[] = [];
  for (const key of [...inPlan].sort((a, b) => order.get(a)! - order.get(b)!)) {
    const step = steps.find((s) => s.quest.key === key);
    nodes.push({
      id: key,
      type: "quest",
      position: pos.get(key)!,
      data: {
        quest: QUEST_BY_KEY[key] ?? target, // cape target is a synthetic quest
        done: false, // overwritten below via completed set
        isExtra: step?.isExtra ?? false,
        isTarget: key === target.key,
        onToggle: () => {}, // replaced below
      },
    });
  }
  for (const g of gates.values()) {
    nodes.push({
      id: g.id,
      type: "gate",
      position: pos.get(g.id)!,
      data: {
        skill: g.skill,
        level: g.level,
        deficit: g.gap.deficit,
        xpNeeded: g.gap.xpNeeded,
        fedCount: g.fed.length,
        firstName: QUEST_BY_KEY[g.fed[0]]?.name ?? g.fed[0],
        firstToStart: g.firstToStart,
      },
    });
  }

  // ---- edges (gate edges first so they render beneath prereq edges)
  const edges: Edge[] = [];
  for (const g of gates.values()) {
    for (const k of g.fed) {
      edges.push({
        id: `${g.id}->${k}`,
        source: g.id,
        target: k,
        type: "spread",
        style: { stroke: GATE_STROKE, strokeWidth: 1.3, strokeDasharray: "5 3" },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: GATE_STROKE },
      });
    }
  }
  for (const key of inPlan) {
    for (const p of parentsOf.get(key) ?? []) {
      const toTarget = key === target.key;
      edges.push({
        id: `${p}->${key}`,
        source: p,
        target: key,
        type: "spread",
        style: toTarget
          ? { stroke: TARGET_STROKE, strokeWidth: 1.8 }
          : { stroke: PREREQ_STROKE, strokeWidth: 1.4 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 13,
          height: 13,
          color: toTarget ? TARGET_STROKE : PREREQ_STROKE,
        },
      });
    }
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
  const routeEdge = (e: Edge, s: { x: number }, t: { x: number }, sBottom: number, tTop: number) => {
    const blocked: [number, number][] = [];
    for (const [id, r] of rects) {
      if (id === e.source || id === e.target) continue;
      if (r.y1 > sBottom + 4 && r.y0 < tTop - 4) blocked.push([r.x0 - 6, r.x1 + 6]);
    }
    if (blocked.length === 0) return; // clear vertical run — plain smoothstep is fine
    blocked.sort((a, b) => a[0] - b[0]);
    // free x-intervals around the blocked columns, with outer margins
    const lo = Math.min(blocked[0][0], s.x, t.x) - 90;
    const hi = Math.max(blocked[blocked.length - 1][1], s.x, t.x) + 90;
    const free: [number, number][] = [];
    let cur = lo;
    for (const [b0, b1] of blocked) {
      if (b0 - cur > 24) free.push([cur, b0]);
      cur = Math.max(cur, b1);
    }
    if (hi - cur > 24) free.push([cur, hi]);
    const desired = (s.x + t.x) / 2;
    const scored = free
      .map(([a, b]) => {
        const x = Math.min(Math.max(desired, a + 10), b - 10);
        // prefer intervals with fewer corridors that vertically overlap this edge
        const occupancy = usedCorridors.filter(
          (u) => u.x >= a && u.x <= b && u.y0 < tTop - 6 && u.y1 > sBottom + 6,
        ).length;
        return { a, b, x, key: Math.abs(x - desired) + occupancy * 46 };
      })
      .sort((p, q) => p.key - q.key);
    for (const iv of scored) {
      // walk outward in 26px steps until the corridor does not clash with
      // another routed edge sharing this vertical span
      const maxStep = Math.ceil((iv.b - iv.a) / 26);
      const cands: number[] = [];
      for (let step = 0; step <= maxStep; step++) {
        for (const cand of step === 0 ? [iv.x] : [iv.x + step * 26, iv.x - step * 26]) {
          if (cand >= iv.a + 10 && cand <= iv.b - 10) cands.push(cand);
        }
      }
      for (const x of cands) {
        const clash = usedCorridors.some(
          (u) => Math.abs(u.x - x) < 26 && u.y0 < tTop - 6 && u.y1 > sBottom + 6,
        );
        if (!clash) {
          usedCorridors.push({ x, y0: sBottom, y1: tTop });
          e.type = "routed";
          e.data = { ...e.data, via: x, turn: 16 };
          return;
        }
      }
    }
    // nowhere clean — leave as smoothstep (rare)
  };

  // ---- spread anchors: every edge end gets its own attach point so lines
  // never overlap where they meet a node
  const posOf = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const spread = (n: number, span: number): number[] =>
    n <= 1 ? [0] : Array.from({ length: n }, (_, i) => -span + (2 * span * i) / (n - 1));

  for (const e of edges) {
    const s = posOf(e.source);
    const t = posOf(e.target);
    const sBottom = s.y + boxH(e.source);
    const tTop = t.y;
    const gapY = tTop - sBottom;
    if (gapY < 30) {
      e.data = { ...e.data, turn: Math.min(46, Math.max(18, gapY * 0.24)) };
      continue;
    }
    routeEdge(e, s, t, sBottom, tTop);
    if (e.type !== "routed") {
      e.data = { ...e.data, turn: Math.min(46, Math.max(18, gapY * 0.24)) };
    }
  }

  const byTarget = new Map<string, Edge[]>();
  const bySource = new Map<string, Edge[]>();
  for (const e of edges) {
    const t = byTarget.get(e.target);
    if (t) t.push(e);
    else byTarget.set(e.target, [e]);
    const s = bySource.get(e.source);
    if (s) s.push(e);
    else bySource.set(e.source, [e]);
  }
  for (const [tid, arr] of byTarget) {
    arr.sort(
      (a, b) => posOf(a.source).x - posOf(b.source).x || posOf(a.source).y - posOf(b.source).y,
    );
    const offs = spread(arr.length, 0.36 * NODE_W); // targets are always quest cards
    arr.forEach((e, i) => {
      e.data = { ...e.data, targetOffset: offs[i] };
    });
  }
  for (const [sid, arr] of bySource) {
    arr.sort(
      (a, b) => posOf(a.target).x - posOf(b.target).x || posOf(a.target).y - posOf(b.target).y,
    );
    if (sid.startsWith("gate:")) {
      // Diamonds: a square-style horizontal spread at the container bottom
      // leaves the line endpoints floating in thin air beside the sloped
      // edges. Attach every edge ON the diamond's lower boundary instead —
      // leftmost target connects on the lower-left edge, rightmost on the
      // lower-right, single edges at the bottom vertex.
      const k = arr.length;
      arr.forEach((e, i) => {
        const t = k === 1 ? 0.5 : i / (k - 1); // 0 (left) → 1 (right)
        const dx = -GATE_ATTACH_SPREAD + 2 * GATE_ATTACH_SPREAD * t;
        // handle sits exactly on the diamond's bottom vertex; walking |dx| along
        // the 45° lower edges rises the attach point by the same amount
        e.data = {
          ...e.data,
          sourceOffset: dx,
          sourceOffsetY: -Math.abs(dx),
        };
      });
      continue;
    }
    const span = 0.36 * NODE_W; // quest cards: spread across the bottom edge
    const offs = spread(arr.length, span);
    arr.forEach((e, i) => {
      e.data = { ...e.data, sourceOffset: offs[i] };
    });
  }

  return { nodes, edges };
}

/* ------------------------------------------------------------- component */

function QuestGraphInner({
  steps,
  target,
  targetGaps,
  completed,
  onToggleCompleted,
}: {
  steps: ChainStep[];
  target: Quest;
  targetGaps: SkillGap[];
  completed: Set<string>;
  onToggleCompleted: (key: string) => void;
}) {
  const { nodes: layoutNodes, edges } = useMemo(
    () => computeLayout(steps, target, targetGaps),
    [steps, target, targetGaps],
  );
  const layoutKey = useMemo(() => layoutNodes.map((n) => n.id).join("|"), [layoutNodes]);

  // "Gates only" focus: hide chain quests that no training gate feeds and drop
  // prereq edges, leaving diamonds + the quests they block (persisted locally).
  // Lazy init is safe — this component mounts client-side only, after the main
  // page's own hydration effects have already decided the view mode.
  const [gatesOnly, setGatesOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("osrs-qp-gatesonly") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("osrs-qp-gatesonly", gatesOnly ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [gatesOnly]);

  const gatedQuestIds = useMemo(
    () => new Set(edges.filter((e) => e.source.startsWith("gate:")).map((e) => e.target)),
    [edges],
  );
  const focusOn = gatesOnly && gatedQuestIds.size > 0;
  const shownEdges = useMemo(
    () => (focusOn ? edges.filter((e) => e.source.startsWith("gate:")) : edges),
    [edges, focusOn],
  );

  // controlled nodes: RF applies dimension/selection/position changes through
  // onNodesChange (measured sizes landing here is what keeps MiniMap + dragging alive)
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const { fitView, setViewport, getNodes } = useReactFlow();
  const prevKeyRef = useRef("");
  const paneRef = useRef<HTMLDivElement>(null);
  const lastPaneSize = useRef({ w: 0, h: 0 });
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  // export the current graph state as a PNG (minimap / controls excluded)
  const exportPng = useCallback(async () => {
    const el = paneRef.current?.querySelector<HTMLElement>(".react-flow");
    if (!el || nodes.length === 0) return;
    setExporting(true);
    try {
      const bounds = graphBounds(nodes.filter((n) => !n.hidden));
      const pad = 80;
      const w = Math.min(Math.ceil(bounds.width) + pad * 2, 4000);
      const h = Math.min(Math.ceil(bounds.height) + pad * 2, 3000);
      const vp = getViewportForBounds(bounds, w, h, 0.2, 2, 0);
      const dataUrl = await toPng(el, {
        backgroundColor: "#0c0a09",
        width: w,
        height: h,
        style: {
          width: `${w}px`,
          height: `${h}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
        filter: (n) => {
          const cls = (n as HTMLElement).classList;
          return !(
            cls?.contains("react-flow__minimap") ||
            cls?.contains("react-flow__controls") ||
            cls?.contains("react-flow__panel")
          );
        },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `quest-path-${(target?.name ?? "graph")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}.png`;
      a.click();
      toast({
        title: "Graph exported",
        description: "PNG downloaded — minimap and controls are excluded.",
      });
    } catch {
      toast({
        title: "Export failed",
        description: "Couldn't render the graph image.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }, [nodes, target, toast]);

  // (re)seed node positions when the plan structure changes — any quest/gate
  // added or removed (done-toggles drop nodes, so they count as structural).
  // Data-only updates (imports/settings with an identical node set) keep
  // user-dragged positions.

  // graph → panel navigation: a gate's hover "+" scrolls the skill's
  // suggestion group into view and flashes it briefly
  const jumpToSkill = useCallback((skill: string) => {
    const el = document.getElementById(skillSuggestAnchorId(skill));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("qa-flash-panel");
    void el.offsetWidth; // restart the animation when spam-clicking gates
    el.classList.add("qa-flash-panel");
    window.setTimeout(() => el.classList.remove("qa-flash-panel"), 2000);
  }, []);

  // smart camera: whole-graph fit while it stays readable; for very tall plans
  // (deep chains zoom out past ~0.5) fit the width instead and anchor to the
  // top so the plan's start is visible — panning/MiniMap covers the rest.
  // Waits (frame-by-frame, bounded) until React Flow has measured the nodes.
  const fitCamera = useCallback(
    (duration = 250, attempt = 0) => {
      const el = paneRef.current;
      if (!el) return;
      const all = getNodes().filter((n) => !n.hidden);
      if (all.length === 0) {
        fitView({ padding: 0.12, maxZoom: 1, duration });
        return;
      }
      const measured = all.filter((n) => n.measured);
      if (measured.length < all.length && attempt < 12) {
        requestAnimationFrame(() => fitCamera(duration, attempt + 1));
        return;
      }
      if (measured.length === 0) {
        fitView({ padding: 0.12, maxZoom: 1, duration });
        return;
      }
      const { width, height } = el.getBoundingClientRect();
      const bounds = graphBounds(measured);
      if (!bounds.width || !bounds.height) {
        fitView({ padding: 0.12, maxZoom: 1, duration });
        return;
      }
      const zoomBoth = Math.min(
        1,
        (width * 0.88) / bounds.width,
        (height * 0.88) / bounds.height,
      );
      if (zoomBoth >= 0.5) {
        fitView({ padding: 0.12, maxZoom: 1, duration });
        return;
      }
      const zoom = Math.max(zoomBoth, Math.min(1, (width * 0.88) / bounds.width));
      setViewport(
        {
          x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
          y: 24 - bounds.y * zoom,
          zoom,
        },
        { duration },
      );
    },
    [getNodes, fitView, setViewport],
  );

  useEffect(() => {
    const structuralChange = prevKeyRef.current !== layoutKey;
    prevKeyRef.current = layoutKey;
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n] as const));
      const next: FlowNode[] = layoutNodes.map((n) => {
        const old = prevById.get(n.id);
        const position = !structuralChange && old ? old.position : n.position;
        if (n.type === "gate") {
          return { ...n, position, hidden: false, data: { ...n.data, onFindSkill: jumpToSkill } };
        }
        return {
          ...n,
          position,
          hidden: focusOn && !gatedQuestIds.has(n.id),
          data: {
            ...n.data,
            done: completed.has(n.id),
            onToggle: onToggleCompleted,
          },
        };
      });
      return next;
    });
    if (structuralChange) {
      requestAnimationFrame(() => fitCamera(250));
    }
  }, [layoutKey, fitCamera, jumpToSkill]);

  // live data sync (completed set / toggle callback) without touching positions
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) =>
        n.type === "gate"
          ? n
          : { ...n, data: { ...n.data, done: completed.has(n.id), onToggle: onToggleCompleted } },
      ),
    );
  }, [completed, onToggleCompleted, setNodes]);

  // apply "gates only" visibility; refit the camera only when the focus
  // actually flips (plan recomputes keep the user's pan/zoom)
  const prevFocusRef = useRef(false);
  useEffect(() => {
    const focusChanged = prevFocusRef.current !== focusOn;
    prevFocusRef.current = focusOn;
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        hidden: focusOn && n.type === "quest" && !gatedQuestIds.has(n.id),
      })),
    );
    if (focusChanged) {
      requestAnimationFrame(() => fitCamera(250));
    }
  }, [focusOn, gatedQuestIds, setNodes, fitCamera]);

  // refit the camera when the pane itself resizes (orientation change,
  // breakpoint height jump) — node positions and user pans are untouched
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const prev = lastPaneSize.current;
      if (
        prev.w !== 0 &&
        (Math.abs(width - prev.w) > 40 || Math.abs(height - prev.h) > 40)
      ) {
        fitCamera(0);
      }
      lastPaneSize.current = { w: width, h: height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitCamera]);

  return (
    <div
      ref={paneRef}
      className="h-[520px] sm:h-[580px] overflow-hidden rounded-md border border-stone-800 bg-stone-950/70"
      aria-label="Quest dependency graph"
    >
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={shownEdges}
        onNodesChange={onNodesChange}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.15}
        nodesConnectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: false }}
      >
        <Panel position="top-left">
          <div className="flex gap-1.5">
            <button
              onClick={() => setGatesOnly((v) => !v)}
              disabled={gatedQuestIds.size === 0}
              aria-pressed={focusOn}
              aria-label="Show only training gates and the quests they block"
              title={
                gatedQuestIds.size === 0
                  ? "No training gates in the current plan"
                  : "Show only training gates and the quests they block"
              }
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm transition-colors ${
                focusOn
                  ? "border-red-700 bg-red-950/90 text-red-200 shadow-[0_0_10px_rgba(220,38,38,0.25)]"
                  : "border-stone-700 bg-stone-900/85 text-stone-300 hover:border-stone-500 hover:text-stone-100"
              } ${gatedQuestIds.size === 0 ? "cursor-not-allowed opacity-40" : ""}`}
            >
              <Filter className="h-3 w-3" aria-hidden />
              Gates only
            </button>
            <button
              onClick={exportPng}
              disabled={exporting || nodes.length === 0}
              aria-label="Download the graph as a PNG image"
              title="Download the graph as a PNG image"
              className="flex items-center gap-1.5 rounded-md border border-stone-700 bg-stone-900/85 px-2.5 py-1 text-[11px] font-medium text-stone-300 backdrop-blur-sm transition-colors hover:border-stone-500 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {exporting ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Camera className="h-3 w-3" aria-hidden />
              )}
              PNG
            </button>
          </div>
        </Panel>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#44403c" />
        <Controls
          className="!shadow-lg"
          showInteractive={false}
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        />
        <MiniMap
          pannable
          zoomable
          className="!border-stone-800"
          nodeColor={(n) => {
            if (n.type === "gate") return "#dc2626";
            const d = (n as QuestFlowNode).data;
            if (d?.isTarget) return "#d97706";
            if (d?.done) return "#059669";
            if (d?.isExtra) return "#0284c7";
            return "#57534e";
          }}
          nodeStrokeWidth={0}
        />
      </ReactFlow>
      <div className="pointer-events-none flex flex-wrap gap-x-3 gap-y-1 border-t border-stone-800 bg-stone-950/80 px-3 py-1.5 text-[9px] text-stone-500">
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle bg-stone-500" />quest</span>
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle bg-amber-600" />target</span>
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle bg-emerald-600" />completed</span>
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle bg-sky-600" />added for XP</span>
        <span><span className="mr-1 inline-block h-2 w-2 rotate-45 border border-red-600 bg-red-950 align-middle" />training gate</span>
        <span className="hidden sm:inline"><span className="mr-1 inline-block h-px w-4 border-t border-dashed border-red-500 align-middle" />train before this quest</span>
        <span className="hidden sm:inline">· drag to rearrange · scroll to zoom · ✓ marks quests done</span>
      </div>
    </div>
  );
}

export function QuestGraph(props: ComponentProps<typeof QuestGraphInner>) {
  return (
    <ReactFlowProvider>
      <QuestGraphInner {...props} />
    </ReactFlowProvider>
  );
}
