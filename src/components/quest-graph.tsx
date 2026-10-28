"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeText,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
  useNodesState,
  useReactFlow,
  useStore,
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
import {
  CLEARANCE,
  GATE_DIAMOND,
  GATE_HANDLE_Y,
  GATE_H,
  GATE_TOP_Y,
  GATE_W,
  NODE_H,
  NODE_W,
  computeLayout,
  type EdgeKind,
  type LayoutEdge,
  type LayoutNode,
} from "@/lib/graph-layout";
import { Quest } from "@/lib/quest-data";
import type { ChainStep, TargetResult, XpCascade } from "@/lib/resolver";

/* -------------------------------------------------------------- constants */

const PREREQ_STROKE = "#57534e";
const TARGET_STROKE = "#d97706";
const GATE_STROKE = "#dc2626";
const CASCADE_STROKE = "#f87171";

// presentation per edge kind (geometry lives in graph-layout.ts)
const EDGE_STYLE: Record<EdgeKind, { stroke: string; strokeWidth: number; dash?: string }> = {
  gate: { stroke: GATE_STROKE, strokeWidth: 1.3, dash: "5 3" },
  tier: { stroke: PREREQ_STROKE, strokeWidth: 1.4 },
  prereq: { stroke: PREREQ_STROKE, strokeWidth: 1.4 },
  target: { stroke: TARGET_STROKE, strokeWidth: 1.8 },
  cascade: { stroke: CASCADE_STROKE, strokeWidth: 1.2, dash: "2 4" },
};
const MARKER_SIZE: Record<EdgeKind, number> = {
  gate: 12,
  tier: 13,
  prereq: 13,
  target: 13,
  cascade: 10,
};

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

/** One diamond = one (skill, level) requirement tier (see graph-layout.ts). */
export type GateNodeData = {
  skill: string;
  level: number; // the tier's requirement level — the diamond's big number
  quest: string; // first quest (plan order) that needs this level
  toStart: boolean; // that quest requires the level to START
  deficit: number; // levels to train for this tier
  xp: number; // raw xp for this tier
  fedCount: number; // quests in the plan needing exactly this level
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
  const { skill, level, quest, toStart, deficit, xp, fedCount, onFindSkill } = data;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="group relative grid h-[88px] w-[118px] cursor-default place-items-center"
          role="img"
          aria-label={`Training gate: raise ${skill} to level ${level} before ${quest}`}
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
            <span className="mt-0.5 tabular-nums text-[12px] font-bold text-red-50">{level}</span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={10}
        arrowClassName={TOOLTIP_ARROW}
        className={`max-w-[300px] px-3 py-2.5 leading-relaxed ${TOOLTIP_BOX}`}
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
          <b className="font-semibold text-stone-900">{deficit}</b> level
          {deficit === 1 ? "" : "s"} (≈{" "}
          <b className="font-semibold text-stone-900">{xp.toLocaleString("en-US")}</b> XP) before{" "}
          {toStart ? "starting" : "completing"}{" "}
          <a
            href={wikiUrl(quest)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-stone-900 underline decoration-stone-400 underline-offset-2 hover:decoration-red-700 hover:text-red-800"
          >
            {quest}
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
      {/* default vertical-vertex handles (no id — edges without an explicit
          handle reference these): target on the top vertex, source on the
          bottom vertex. Explicit ids below cover the side vertices and the
          upward top-vertex exit used by same-row / upward tier chains. */}
      <Handle
        type="target"
        position={Position.Top}
        className="!opacity-0"
        style={{
          // tier-chain + cascade edges attach ON the diamond's top vertex
          // (top-anchored, explicit size, y-shift killed — mirrors the source
          // handle below)
          top: GATE_TOP_Y,
          left: "50%",
          bottom: "auto",
          width: 6,
          height: 6,
          transform: "translate(-50%, 0)",
        }}
      />
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
      <Handle
        id="t-up"
        type="source"
        position={Position.Top}
        className="!opacity-0"
        style={{
          // upward tier chains leave through the top vertex (same anchor
          // point as the target handle above, opposite direction)
          top: GATE_TOP_Y,
          left: "50%",
          bottom: "auto",
          width: 6,
          height: 6,
          transform: "translate(-50%, 0)",
        }}
      />
      {/* side vertices — RF anchors Left/Right handles at (x, y+½h) /
          (x+w, y+½h), so these pin to the diamond's side tips at row-center
          height; same-row tier chains draw a straight line between them */}
      <Handle
        id="s-right"
        type="source"
        position={Position.Right}
        className="!opacity-0"
        style={{
          left: GATE_W / 2 + GATE_DIAMOND - 6,
          top: GATE_H / 2 - 3,
          bottom: "auto",
          width: 6,
          height: 6,
          transform: "none",
        }}
      />
      <Handle
        id="s-left"
        type="source"
        position={Position.Left}
        className="!opacity-0"
        style={{
          left: GATE_W / 2 - GATE_DIAMOND,
          top: GATE_H / 2 - 3,
          bottom: "auto",
          width: 6,
          height: 6,
          transform: "none",
        }}
      />
      <Handle
        id="t-right"
        type="target"
        position={Position.Right}
        className="!opacity-0"
        style={{
          left: GATE_W / 2 + GATE_DIAMOND - 6,
          top: GATE_H / 2 - 3,
          bottom: "auto",
          width: 6,
          height: 6,
          transform: "none",
        }}
      />
      <Handle
        id="t-left"
        type="target"
        position={Position.Left}
        className="!opacity-0"
        style={{
          left: GATE_W / 2 - GATE_DIAMOND,
          top: GATE_H / 2 - 3,
          bottom: "auto",
          width: 6,
          height: 6,
          transform: "none",
        }}
      />
    </Tooltip>
  );
}

const NODE_TYPES = { quest: QuestNode, gate: GateNode };

/* ---------------------------------------------------------------- edges */

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
 * Orthogonal edge whose attach points are spread across the node borders.
 * The first and last segments are ALWAYS vertical: every downward edge leaves
 * its source through the bottom and enters its target through the top
 * (upward edges mirror that), no matter how many rows separate the
 * endpoints — a plain smoothstep would put its horizontal jog at the
 * source-target midpoint, slicing through intermediate node rows.
 *
 * The horizontal jog happens on a fixed row (CLEARANCE below the source for
 * downward edges / above the target for upward ones) inside the free band
 * between node rows. Edges whose vertical run would cross other nodes are
 * displaced to a precomputed corridor x (`data.via`) in the gaps between
 * columns, so lines stop running behind quest cards and gates.
 */
function SpreadEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as unknown as LayoutEdge;
  const sx = sourceX + (d.sourceOffset ?? 0);
  const sy = sourceY + (d.sourceOffsetY ?? 0);
  const tx = targetX + (d.targetOffset ?? 0);
  const ty = targetY + (d.targetOffsetY ?? 0);
  const up = ty < sy;
  const jog = Math.min(CLEARANCE, Math.abs(ty - sy) / 3);
  let pts: [number, number][];
  let labelX: number;
  let labelY: number;
  if (d.via !== undefined) {
    // routed: step away from the source, run the corridor, step into the
    // target — the approach is always from above the target's top attach
    const leaveY = up ? sy - 16 : sy + 16;
    const enterY = ty - 16;
    pts = [
      [sx, sy],
      [sx, leaveY],
      [d.via, leaveY],
      [d.via, enterY],
      [tx, enterY],
      [tx, ty],
    ];
    labelX = d.via;
    labelY = leaveY;
  } else {
    const midY = up ? ty + jog : sy + jog;
    pts = [
      [sx, sy],
      [sx, midY],
      [tx, midY],
      [tx, ty],
    ];
    labelX = (sx + tx) / 2;
    labelY = midY;
  }
  return (
    <>
      <BaseEdge id={id} path={roundedPath(pts, 12)} style={style} markerEnd={markerEnd} />
      {d.label && <EdgeLabel x={labelX} y={labelY} text={d.label} />}
    </>
  );
}

const EDGE_TYPES = { spread: SpreadEdge };

/**
 * Small pill label pinned alongside an edge (used by XP-cascade edges).
 *
 * Semantic zoom (industry convention for dense graphs — e.g. ELK's
 * detail-fade / Graphviz behavior of dropping detail at low magnification):
 * labels are pure noise once the whole board fits out, so they render only
 * when the zoom level is high enough to actually read them.
 */
function EdgeLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const zoom = useStore((s) => s.transform[2]);
  if (zoom < 0.5) return null;
  return (
    <EdgeText
      x={x}
      y={y}
      label={text}
      labelShowBg
      labelBgPadding={[4, 2]}
      labelBgBorderRadius={4}
      labelBgStyle={{ fill: "#0c0a09", stroke: "#7f1d1d", strokeWidth: 0.5 }}
      style={{ fill: "#fca5a5", fontSize: 9, fontWeight: 600 }}
    />
  );
}

/** Map a pure layout edge onto a React Flow edge (geometry in, style out). */
function toFlowEdge(e: LayoutEdge): Edge {
  const visual = EDGE_STYLE[e.kind];
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
    type: "spread",
    style: {
      stroke: visual.stroke,
      strokeWidth: visual.strokeWidth,
      ...(visual.dash ? { strokeDasharray: visual.dash } : {}),
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: MARKER_SIZE[e.kind],
      height: MARKER_SIZE[e.kind],
      color: visual.stroke,
    },
    data: e as unknown as Record<string, unknown>,
  };
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

/* ------------------------------------------------------------- component */

function QuestGraphInner({
  steps,
  targets,
  cascades,
  completed,
  onToggleCompleted,
}: {
  steps: ChainStep[];
  targets: TargetResult[];
  cascades: XpCascade[];
  completed: Set<string>;
  onToggleCompleted: (key: string) => void;
}) {
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => computeLayout(steps, targets, cascades),
    [steps, targets, cascades],
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
    () => new Set(layoutEdges.filter((e) => e.kind === "gate").map((e) => e.target)),
    [layoutEdges],
  );
  const focusOn = gatesOnly && gatedQuestIds.size > 0;
  const shownEdges = useMemo(
    () =>
      (focusOn ? layoutEdges.filter((e) => e.kind === "gate") : layoutEdges).map(toFlowEdge),
    [layoutEdges, focusOn],
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

  // export the ENTIRE graph as a PNG — not just what happens to be on screen.
  // Captures the .react-flow__viewport element and overrides its transform
  // with one that frames the full node bounds (the official React Flow
  // download-image recipe). Graphs bigger than the browser's canvas limits
  // (16384px per side, ~64MP total area) are scaled down just enough to fit —
  // the whole graph always makes it into the image.
  const exportPng = useCallback(async () => {
    const el = paneRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!el || nodes.length === 0) return;
    setExporting(true);
    try {
      const bounds = graphBounds(nodes.filter((n) => !n.hidden));
      const pad = 80;
      const MAX_DIM = 16384;
      const MAX_AREA = 64 * 1024 * 1024; // ≈ 8192 × 8192 — safe on desktop browsers
      const fullW = Math.ceil(bounds.width) + pad * 2;
      const fullH = Math.ceil(bounds.height) + pad * 2;
      const scale = Math.min(
        1,
        MAX_DIM / fullW,
        MAX_DIM / fullH,
        Math.sqrt(MAX_AREA / (fullW * fullH)),
      );
      const w = Math.max(1, Math.floor(fullW * scale));
      const h = Math.max(1, Math.floor(fullH * scale));
      const vp = getViewportForBounds(bounds, w, h, 0.05, 2, 0);
      const dataUrl = await toPng(el, {
        backgroundColor: "#0c0a09",
        width: w,
        height: h,
        pixelRatio: 1, // default (devicePixelRatio) would double the canvas past the limits
        style: {
          width: `${w}px`,
          height: `${h}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `quest-path-${(targets[0]?.quest.name ?? "graph")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}.png`;
      a.click();
      toast({
        title: "Graph exported",
        description: `Entire graph downloaded (${w.toLocaleString()} × ${h.toLocaleString()} px${
          scale < 1 ? " — scaled to fit canvas limits" : ""
        }).`,
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
  }, [nodes, targets, toast]);

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
      const next: FlowNode[] = layoutNodes.map((n: LayoutNode) => {
        const old = prevById.get(n.id);
        const position = !structuralChange && old ? old.position : { x: n.x, y: n.y };
        if (n.kind === "gate") {
          const gate: GateFlowNode = {
            id: n.id,
            type: "gate",
            position,
            hidden: false,
            data: {
              skill: n.skill,
              level: n.level,
              quest: n.quest,
              toStart: n.toStart,
              deficit: n.deficit,
              xp: n.xp,
              fedCount: n.fedCount,
              onFindSkill: jumpToSkill,
            },
          };
          return gate;
        }
        const quest: QuestFlowNode = {
          id: n.id,
          type: "quest",
          position,
          hidden: focusOn && !gatedQuestIds.has(n.id),
          data: {
            quest: n.quest,
            done: completed.has(n.id),
            isExtra: n.isExtra,
            isTarget: n.isTarget,
            onToggle: onToggleCompleted,
          },
        };
        return quest;
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
        <span className="hidden sm:inline"><span className="mr-1 inline-block h-px w-4 border-t-2 border-dotted border-red-400 align-middle" />quest XP raises this skill</span>
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
