/**
 * Render a graph-layout scenario to PNG so graph geometry can be inspected
 * without a browser (QA companion to verify-graph-layout.ts).
 *
 * Run (repo root) — same tsc recipe as the verify harness, plus sharp:
 *   npx tsc tools/render-preview.ts --outDir .verify --module commonjs \
 *       --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
 *   node .verify/tools/render-preview.js out.png
 *
 * Replicates quest-graph.tsx's SpreadEdge path math and gate handle anchors.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import {
  CLEARANCE,
  GATE_DIAMOND,
  GATE_H,
  GATE_HANDLE_Y,
  GATE_TOP_Y,
  GATE_W,
  NODE_H,
  NODE_W,
  computeLayout,
  type LayoutEdge,
  type LayoutNode,
} from "../src/lib/graph-layout";
import { SKILL_NAMES, xpForLevel, type PlayerSkills } from "../src/lib/quest-data";
import { resolveChain } from "../src/lib/resolver";

const STYLE: Record<string, { stroke: string; width: number; dash?: string }> = {
  gate: { stroke: "#dc2626", width: 1.3, dash: "5 3" },
  tier: { stroke: "#8a857e", width: 1.6 },
  prereq: { stroke: "#7a756e", width: 1.4 },
  target: { stroke: "#d97706", width: 1.8 },
  cascade: { stroke: "#f87171", width: 1.4, dash: "2 4" },
};

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

/** gate handle anchor (container-relative) per handle id — mirrors GateNode */
function gateAnchor(id: string | undefined): { x: number; y: number } {
  switch (id) {
    case "s-right":
      return { x: GATE_W / 2 + GATE_DIAMOND, y: GATE_H / 2 };
    case "s-left":
      return { x: GATE_W / 2 - GATE_DIAMOND, y: GATE_H / 2 };
    case "t-up":
      return { x: GATE_W / 2, y: GATE_TOP_Y };
    default:
      return { x: GATE_W / 2, y: GATE_HANDLE_Y };
  }
}
function gateTargetAnchor(id: string | undefined): { x: number; y: number } {
  if (id === "t-left") return { x: GATE_W / 2 - GATE_DIAMOND, y: GATE_H / 2 };
  if (id === "t-right") return { x: GATE_W / 2 + GATE_DIAMOND, y: GATE_H / 2 };
  return { x: GATE_W / 2, y: GATE_TOP_Y };
}

/** SpreadEdge's path math, verbatim */
function edgePath(e: LayoutEdge, pos: Map<string, LayoutNode>): string {
  const s = pos.get(e.source)!;
  const t = pos.get(e.target)!;
  let sx: number, sy: number, tx: number, ty: number;
  if (s.kind === "gate") {
    const a = gateAnchor(e.sourceHandle);
    sx = s.x + a.x + (e.sourceOffset ?? 0);
    sy = s.y + a.y + (e.sourceOffsetY ?? 0);
  } else {
    sx = s.x + NODE_W / 2 + (e.sourceOffset ?? 0);
    sy = s.y + NODE_H + (e.sourceOffsetY ?? 0);
  }
  if (t.kind === "gate") {
    const a = gateTargetAnchor(e.targetHandle);
    tx = t.x + a.x + (e.targetOffset ?? 0);
    ty = t.y + a.y + (e.targetOffsetY ?? 0);
  } else {
    tx = t.x + NODE_W / 2 + (e.targetOffset ?? 0);
    ty = t.y + (e.targetOffsetY ?? 0);
  }
  const up = ty < sy;
  const jog = Math.min(CLEARANCE, Math.abs(ty - sy) / 3);
  let pts: [number, number][];
  if (e.via !== undefined) {
    const leaveY = up ? sy - 16 : sy + 16;
    const enterY = ty - 16;
    pts = [
      [sx, sy],
      [sx, leaveY],
      [e.via, leaveY],
      [e.via, enterY],
      [tx, enterY],
      [tx, ty],
    ];
  } else {
    const midY = up ? ty + jog : sy + jog;
    pts = [
      [sx, sy],
      [sx, midY],
      [tx, midY],
      [tx, ty],
    ];
  }
  return roundedPath(pts, 12);
}

function mkPlayer(over: Record<string, number>, xpTable: (l: number) => number): PlayerSkills {
  const levels: Record<string, number> = {};
  const xp: Record<string, number> = {};
  for (const s of SKILL_NAMES) {
    levels[s] = over[s] ?? 99;
    xp[s] = xpTable(levels[s]);
  }
  return { levels, xp, combatLevel: over.Combat ?? 126, source: "manual" };
}

// ---- script body -----------------------------------------------------------

const out = process.argv[2] ?? "graph-preview.png";
const scenario = process.argv[3] ?? "A";

const scenarios: Record<string, () => ReturnType<typeof computeLayout>> = {
  // A: the user's Lunar + Hand scenario, low crafting (FT's XP cascades here)
  A: () => {
    const r = resolveChain(
      ["lunar diplomacy"],
      mkPlayer({ Crafting: 25 }, xpForLevel),
      new Set(),
      { allowBoosts: false, includeQuestXp: true },
      ["hand in sand"],
    )!;
    return computeLayout(r.steps, r.targets, r.cascades);
  },
  // B: mid crafting — no FT cascade, hand 49 gate + lunar 61 gate
  B: () => {
    const r = resolveChain(
      ["lunar diplomacy"],
      mkPlayer({ Crafting: 45 }, xpForLevel),
      new Set(),
      { allowBoosts: false, includeQuestXp: true },
      ["hand in sand"],
    )!;
    return computeLayout(r.steps, r.targets, r.cascades);
  },
};

const { nodes, edges } = scenarios[scenario]();
const pos = new Map(nodes.map((n) => [n.id, n] as const));

let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const n of nodes) {
  const w = n.kind === "gate" ? GATE_W : NODE_W;
  const h = n.kind === "gate" ? GATE_H : NODE_H;
  x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
  x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
}
const PAD = 90;
const W = x1 - x0 + PAD * 2, H = y1 - y0 + PAD * 2;
const ox = PAD - x0, oy = PAD - y0;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
parts.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`);
parts.push(`<rect width="${W}" height="${H}" fill="#0c0a09"/>`);

for (const e of edges) {
  const st = STYLE[e.kind];
  const d = edgePath(e, pos);
  const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : "";
  parts.push(`<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}"${dash} marker-end="url(#arr)"/>`);
  if (e.label) {
    const m = d.match(/L ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/);
    const lx = m ? (Number(m[1]) + Number(m[3])) / 2 : 0;
    const ly = m ? Number(m[2]) : 0;
    parts.push(`<rect x="${lx - 26}" y="${ly - 8}" width="52" height="14" rx="4" fill="#0c0a09" stroke="#7f1d1d" stroke-width="0.5"/><text x="${lx}" y="${ly + 3}" font-size="9" font-weight="600" fill="#fca5a5" text-anchor="middle">${esc(e.label)}</text>`);
  }
}

for (const n of nodes) {
  if (n.kind === "gate") {
    const cx = n.x + GATE_W / 2 + ox, cy = n.y + GATE_H / 2 + oy;
    parts.push(`<rect x="${cx - 28}" y="${cy - 28}" width="56" height="56" rx="5" transform="rotate(45 ${cx} ${cy})" fill="#450a0a" stroke="#b91c1c" stroke-width="1"/>`);
    parts.push(`<text x="${cx}" y="${cy - 4}" font-size="10" font-weight="600" fill="#fecaca" text-anchor="middle">${esc(n.skill)}</text>`);
    parts.push(`<text x="${cx}" y="${cy + 10}" font-size="13" font-weight="700" fill="#fee2e2" text-anchor="middle">${n.level}</text>`);
  } else {
    const border = n.isTarget ? "#d97706" : n.isExtra ? "#0284c7" : "#57534e";
    parts.push(`<rect x="${n.x + ox}" y="${n.y + oy}" width="${NODE_W}" height="${NODE_H}" rx="8" fill="#1c1917" stroke="${border}" stroke-width="1.5"/>`);
    const words = n.quest.name.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > 26) { lines.push(cur.trim()); cur = w; } else cur += " " + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    lines.forEach((ln, i) =>
      parts.push(`<text x="${n.x + ox + NODE_W / 2}" y="${n.y + oy + 26 + i * 14}" font-size="11" font-weight="600" fill="#f5f5f4" text-anchor="middle">${esc(ln)}</text>`),
    );
  }
}
parts.push("</svg>");

mkdirSync(".verify", { recursive: true });
writeFileSync(".verify/preview.svg", parts.join("\n"));
sharp(Buffer.from(parts.join("\n")))
  .resize({ width: Math.min(2200, W) })
  .png()
  .toFile(out)
  .then(() => {
    console.log(`scenario ${scenario}: ${nodes.length} nodes, ${edges.length} edges → ${out} (${W}x${H})`);
    console.log(`gates: ${nodes.filter((n) => n.kind === "gate").map((n) => (n.kind === "gate" ? `${n.skill}:${n.level}` : "")).join(", ")}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
