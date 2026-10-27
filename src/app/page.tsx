"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { QuestGraph } from "@/components/quest-graph";
import { ReqChip, SkillSuggestionsPanel, SuggestionGroup, SugSort, TOOLTIP_ARROW, TOOLTIP_BOX, UnmetEntry, UnmetRequirementsPanel } from "@/components/skill-panels";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  Check,
  Clock,
  Copy,
  Download,
  FileUp,
  HardDriveDownload,
  List,
  ListChecks,
  Loader2,
  Network,
  RefreshCw,
  Sparkles,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  DIFF_COLORS,
  QUESTS,
  QUEST_BY_KEY,
  QUEST_CAPE_KEY,
  QUEST_CAPE_QUEST,
  PlayerSkills,
  formatHours,
  formatMinutes,
  formatXp,
  isValidTargetKey,
  questMinutes,
  totalQuestPoints,
  trainHours,
} from "@/lib/quest-data";
import { ResolveResult, SkillGap, TargetResult, missingPrereqClosure, questSkillGaps, resolveChain } from "@/lib/resolver";
import { APP_BUILD, APP_VERSION } from "@/lib/version";

/* ------------------------------------------------------------------ utils */

const DIFF_ORDER = ["Novice", "Intermediate", "Experienced", "Master", "Grandmaster", "Special", "Miniquest", "Activity", "Unknown"];

function wikiUrl(name: string) {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(name).replace(/%2F/g, "/").replace(/%20/g, "_")}`;
}

const DEFAULT_PLAYER: PlayerSkills = {
  levels: {}, xp: {}, combatLevel: 3, source: "manual",
};

/** one-click classic endgame goals — chips under the target picker */
const GOAL_PRESETS: { label: string; key: string }[] = [
  { label: "Quest Cape", key: QUEST_CAPE_KEY },
  { label: "Barrows Gloves", key: "recipe for disaster" },
  { label: "Desert Treasure II", key: "desert treasure ii fallen empire" },
  { label: "Dragon Slayer II", key: "dragon slayer ii" },
  { label: "Monkey Madness II", key: "monkey madness ii" },
  { label: "Song of the Elves", key: "song of elves" },
  { label: "While Guthix Sleeps", key: "while guthix sleeps" },
  { label: "Desert Treasure", key: "desert treasure i" },
  { label: "Lunar Diplomacy", key: "lunar diplomacy" },
];

/** locally stored character slot — skills + quest progress, no WOM round-trip to load */
type CharSlot = {
  name: string;
  player: PlayerSkills | null;
  completed: string[];
  /** total quest points for `completed` at save time (1 per quest, miniquests 0) */
  questPoints: number;
  added: string[];
  /** tracked target quests (multi-track) */
  targets: string[];
  savedAt: string;
};

/* -------------------------------------------------- backup / restore types */

type BackupData = {
  completed: string[];
  /** total quest points for `completed` (1 per quest, miniquests/activities 0) */
  questPoints: number | null;
  added: string[];
  targets: string[];
  allowBoosts: boolean;
  includeQuestXp: boolean;
  manualQp: number | "";
  username: string;
  player: PlayerSkills | null;
};

function parseBackup(raw: string): { ok: true; data: BackupData } | { ok: false; text: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, text: "Invalid JSON — could not parse the backup." };
  }
  const root = parsed as { app?: unknown; data?: Record<string, unknown> } | null;
  if (!root || root.app !== "quest-pathfinder" || typeof root.data !== "object" || root.data === null) {
    return { ok: false, text: "This doesn't look like a Quest Pathfinder backup file." };
  }
  const d = root.data;
  const cleanKeys = (v: unknown): string[] =>
    Array.isArray(v)
      ? [...new Set(v.filter((k): k is string => typeof k === "string" && !!QUEST_BY_KEY[k]))]
      : [];
  const rawTargets = Array.isArray(d.targets)
    ? d.targets
    : d.target != null
      ? [d.target] // v1 backups stored a single target
      : [];
  const rawPlayer = d.player as (PlayerSkills & Record<string, unknown>) | undefined;
  const player: PlayerSkills | null =
    rawPlayer && typeof rawPlayer === "object" && typeof rawPlayer.levels === "object" && rawPlayer.levels !== null
      ? {
          ...rawPlayer,
          levels: (rawPlayer.levels as PlayerSkills["levels"]) ?? {},
          xp: (rawPlayer.xp as PlayerSkills["xp"]) ?? {},
          combatLevel: typeof rawPlayer.combatLevel === "number" ? rawPlayer.combatLevel : 3,
          source: typeof rawPlayer.source === "string" ? rawPlayer.source : "manual",
        }
      : null;
  return {
    ok: true,
    data: {
      completed: cleanKeys(d.completed),
      questPoints:
        typeof d.questPoints === "number" && Number.isFinite(d.questPoints) && d.questPoints >= 0
          ? Math.floor(d.questPoints)
          : null,
      added: cleanKeys(d.added),
      targets: [
        ...new Set(
          rawTargets.filter(
            (k): k is string => typeof k === "string" && isValidTargetKey(k),
          ),
        ),
      ],
      allowBoosts: typeof d.allowBoosts === "boolean" ? d.allowBoosts : true,
      includeQuestXp: typeof d.includeQuestXp === "boolean" ? d.includeQuestXp : true,
      manualQp:
        typeof d.manualQp === "number" && Number.isFinite(d.manualQp) && d.manualQp >= 0
          ? Math.floor(d.manualQp)
          : "",
      username: typeof d.username === "string" ? d.username : "",
      player,
    },
  };
}

function gapBadgeClass(g: SkillGap): string {
  switch (g.status) {
    case "covered-by-quest-xp":
      return "bg-emerald-900/60 text-emerald-300 border-emerald-600/50";
    case "boost-ok":
      return "bg-amber-900/60 text-amber-300 border-amber-600/50";
    default:
      return "bg-red-900/60 text-red-300 border-red-600/50";
  }
}

function gapLabel(g: SkillGap): string {
  switch (g.status) {
    case "covered-by-quest-xp":
      return `${g.skill} ${g.required} — covered by quest XP`;
    case "boost-ok":
      return `${g.skill} ${g.required} — boostable`;
    default:
      return `${g.skill} ${g.required} — train ${g.deficit} lv${g.deficit > 1 ? "s" : ""} (~${formatXp(g.xpNeeded)} XP)`;
  }
}

/* ------------------------------------------------------------------ page */

/** smooth eased count-up for stat numbers; resumes from the last shown value */
function useCountUp(target: number, duration = 650): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  useEffect(() => {
    const from = valueRef.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      valueRef.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export default function Home() {
  const [targetKeys, setTargetKeys] = useState<string[]>([]);
  const [player, setPlayer] = useState<PlayerSkills | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [allowBoosts, setAllowBoosts] = useState(true);
  const [includeQuestXp, setIncludeQuestXp] = useState(true);
  const [username, setUsername] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualQp, setManualQp] = useState<number | "">("");
  const [addedQuests, setAddedQuests] = useState<Set<string>>(new Set());
  const [pendingAdd, setPendingAdd] = useState<{
    questKey: string;
    missing: string[];
    skillGaps: SkillGap[]; // the quest's own unmet (train) skill requirements
  } | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [backupOpen, setBackupOpen] = useState(false);
  const [importRaw, setImportRaw] = useState("");
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [chars, setChars] = useState<CharSlot[]>([]);
  const [refreshingChar, setRefreshingChar] = useState<string | null>(null);
  const [sugSort, setSugSort] = useState<SugSort>(() => {
    if (typeof window === "undefined") return "xp";
    try {
      const v = localStorage.getItem("osrs-qp-sugsort");
      if (v === "xp" || v === "eff" || v === "time" || v === "reqs") return v;
    } catch { /* ignore */ }
    return "xp";
  });
  const hydrated = useRef(false);
  const { toast } = useToast();

  // ---- localStorage hydration / persistence
  useEffect(() => {
    try {
      const c = localStorage.getItem("osrs-qp-completed");
      if (c) setCompleted(new Set(JSON.parse(c)));
      const u = localStorage.getItem("osrs-qp-username");
      if (u) setUsername(u);
      const p = localStorage.getItem("osrs-qp-player");
      if (p) setPlayer(JSON.parse(p));
      const ts = localStorage.getItem("osrs-qp-targets");
      if (ts) {
        const arr = JSON.parse(ts);
        if (Array.isArray(arr)) {
          const valid = arr.filter(
            (k: unknown): k is string => typeof k === "string" && isValidTargetKey(k),
          );
          if (valid.length) setTargetKeys([...new Set(valid)]);
        }
      } else {
        // migrate pre-multi-track saves (single osrs-qp-target string)
        const t = localStorage.getItem("osrs-qp-target");
        if (t && isValidTargetKey(t)) setTargetKeys([t]);
      }
      const ab = localStorage.getItem("osrs-qp-boosts");
      if (ab !== null) setAllowBoosts(ab === "1");
      const v = localStorage.getItem("osrs-qp-view");
      if (v === "graph" || v === "list") setViewMode(v);
      const qx = localStorage.getItem("osrs-qp-questxp");
      if (qx !== null) setIncludeQuestXp(qx === "1");
      const mq = localStorage.getItem("osrs-qp-manualqp");
      if (mq !== null && mq !== "") setManualQp(parseInt(mq, 10) || "");
      const aq = localStorage.getItem("osrs-qp-added");
      if (aq) setAddedQuests(new Set(JSON.parse(aq)));
      const ch = localStorage.getItem("osrs-qp-chars");
      if (ch) {
        const parsed = JSON.parse(ch);
        if (Array.isArray(parsed)) {
          // coerce pre-multi-track slots (no targets/questPoints fields)
          setChars(
            parsed
              .filter((c) => c && typeof c.name === "string")
              .map((c) => ({
                ...c,
                completed: Array.isArray(c.completed) ? c.completed : [],
                added: Array.isArray(c.added) ? c.added : [],
                targets: Array.isArray(c.targets)
                  ? c.targets
                  : c.target
                    ? [c.target]
                    : [],
                questPoints:
                  typeof c.questPoints === "number"
                    ? c.questPoints
                    : totalQuestPoints(Array.isArray(c.completed) ? c.completed : []),
              })),
          );
        }
      }
      const ss = localStorage.getItem("osrs-qp-sugsort");
      if (ss === "xp" || ss === "eff" || ss === "time" || ss === "reqs") setSugSort(ss);
    } catch { /* ignore */ }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem("osrs-qp-completed", JSON.stringify([...completed]));
  }, [completed]);
  useEffect(() => {
    if (!hydrated.current) return;
    if (targetKeys.length) localStorage.setItem("osrs-qp-targets", JSON.stringify(targetKeys));
    else localStorage.removeItem("osrs-qp-targets");
    localStorage.removeItem("osrs-qp-target"); // pre-multi-track key
  }, [targetKeys]);
  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem("osrs-qp-boosts", allowBoosts ? "1" : "0");
    localStorage.setItem("osrs-qp-questxp", includeQuestXp ? "1" : "0");
    localStorage.setItem("osrs-qp-manualqp", String(manualQp));
    localStorage.setItem("osrs-qp-added", JSON.stringify([...addedQuests]));
    localStorage.setItem("osrs-qp-view", viewMode);
    localStorage.setItem("osrs-qp-chars", JSON.stringify(chars));
    localStorage.setItem("osrs-qp-sugsort", sugSort);
  }, [allowBoosts, includeQuestXp, manualQp, addedQuests, viewMode, chars, sugSort]);

  // ---- resolve chain (recomputes on every mutation — 215 quests, trivial cost)
  const addTargetKey = useCallback((key: string) => {
    setTargetKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const removeTargetKey = useCallback((key: string) => {
    setTargetKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  const result: ResolveResult | null = useMemo(() => {
    if (targetKeys.length === 0) return null;
    const r = resolveChain(
      targetKeys,
      player ?? DEFAULT_PLAYER,
      completed,
      { allowBoosts, includeQuestXp },
      [...addedQuests],
    );
    if (!r) return null;
    // manual quest-point override wins; otherwise the resolver's model estimate
    if (typeof manualQp === "number") r.estQp = manualQp;
    return r;
  }, [targetKeys, player, completed, allowBoosts, includeQuestXp, manualQp, addedQuests]);

  const totalXpNeeded = useMemo(
    () => result?.skillTotals.reduce((a, g) => a + g.xpNeeded, 0) ?? 0,
    [result],
  );

  // estimated playtime for the whole plan (quests with a known wiki length)
  const planMinutes = useMemo(() => {
    if (!result) return 0;
    let m = 0;
    for (const s of result.steps) m += questMinutes(s.quest) ?? 0;
    for (const t of result.targets) m += questMinutes(t.quest) ?? 0;
    return m;
  }, [result]);
  const isCape = targetKeys.includes(QUEST_CAPE_KEY);
  const stepsNeedingTraining = useMemo(
    () => result?.steps.filter((s) => s.needsTraining).length ?? 0,
    [result],
  );
  // the target's OWN unmet requirements count too (e.g. Lunar Diplomacy's 65
  // Magic lives on the target itself, not on any prerequisite step)
  const targetsNeedingTraining = useMemo(
    () => result?.targets.filter((t) => t.gaps.some((g) => g.status === "train")).length ?? 0,
    [result],
  );

  // unique quests in the plan (steps + targets — a tracked target can double
  // as another target's prerequisite; display/stats dedupe it)
  const planQuests = useMemo(() => {
    const s = new Set<string>();
    if (result) {
      for (const st of result.steps) s.add(st.quest.key);
      for (const t of result.targets) s.add(t.quest.key);
    }
    return s;
  }, [result]);

  // plan completion progress (unique plan quests ticked off)
  const planDone = useMemo(() => {
    let n = 0;
    for (const key of planQuests) if (completed.has(key)) n++;
    return n;
  }, [planQuests, completed]);
  const planTotalPct = result
    ? Math.round((planDone / Math.max(1, planQuests.size)) * 100)
    : 0;

  // every quest currently in the plan — alias of planQuests (steps + targets)
  const inPlan = planQuests;

  // every unmet skill requirement across the chain (incl. the target),
  // deduped by skill+level+status, in order of first appearance in the path
  const unmetEntries = useMemo<UnmetEntry[]>(() => {
    if (!result) return [];
    const map = new Map<string, UnmetEntry>();
    const push = (g: SkillGap, questName: string) => {
      const k = `${g.skill}|${g.required}|${g.status}`;
      let e = map.get(k);
      if (!e) {
        e = {
          skill: g.skill, required: g.required, status: g.status, base: g.base,
          effective: g.effective, deficit: g.deficit, xpNeeded: g.xpNeeded,
          boostable: g.boostable, requiredToStart: g.requiredToStart, quests: [],
        };
        map.set(k, e);
      }
      if (e.quests.length < 6 && !e.quests.includes(questName)) e.quests.push(questName);
    };
    for (const st of result.steps) for (const g of st.gaps) push(g, st.quest.name);
    for (const t of result.targets) {
      for (const g of t.gaps) push(g, t.quest.name);
    }
    return [...map.values()];
  }, [result]);

  // per-skill quest suggestions targeting the real training gaps, sorted by the
  // user's choice — all sort modes account for each candidate's OPEN prereqs
  // (count + estimated playtime of the whole unmet closure); every candidate
  // also carries its own skill reqs vs the player so unmet ones render red
  const suggestionGroups = useMemo<SuggestionGroup[]>(() => {
    if (!result || result.skillTotals.length === 0) return [];
    const pool = QUESTS.filter((q) => !inPlan.has(q.key) && !completed.has(q.key));
    if (pool.length === 0) return []; // e.g. Quest Cape mode — everything is planned
    const gapOpts = { allowBoosts, includeQuestXp };
    const gapPlayer = player ?? DEFAULT_PLAYER;
    const totalMinutes = (s: { minutes: number | null; prereqMinutes: number }) =>
      s.minutes === null ? Number.POSITIVE_INFINITY : s.minutes + s.prereqMinutes;
    return result.skillTotals.map((g) => {
      const cands = pool
        .filter((q) => (q.xp[g.skill] ?? 0) > 0)
        .map((q) => {
          const closure = missingPrereqClosure(q.key, completed, inPlan);
          const prereqMinutes = closure.reduce(
            (a, k) => a + (questMinutes(QUEST_BY_KEY[k]) ?? 0),
            0,
          );
          return {
            quest: q,
            xp: q.xp[g.skill] ?? 0,
            openPrereqs: closure.length,
            minutes: questMinutes(q),
            prereqMinutes,
            reqs: questSkillGaps(q, gapPlayer, gapOpts),
          };
        });
      const unmetTrain = (s: { reqs: SkillGap[] }) =>
        s.reqs.filter((r) => r.status === "train").length;
      switch (sugSort) {
        case "eff":
          cands.sort(
            (a, b) =>
              b.xp / Math.max(1, totalMinutes(b)) - a.xp / Math.max(1, totalMinutes(a)) ||
              a.quest.name.localeCompare(b.quest.name),
          );
          break;
        case "time":
          cands.sort(
            (a, b) => totalMinutes(a) - totalMinutes(b) || b.xp - a.xp,
          );
          break;
        case "reqs":
          cands.sort(
            (a, b) =>
              a.openPrereqs + unmetTrain(a) - (b.openPrereqs + unmetTrain(b)) ||
              totalMinutes(a) - totalMinutes(b) ||
              b.xp - a.xp,
          );
          break;
        default:
          cands.sort(
            (a, b) => b.xp - a.xp || a.quest.name.localeCompare(b.quest.name),
          );
      }
      return {
        skill: g.skill,
        required: g.required,
        deficit: g.deficit,
        xpNeeded: g.xpNeeded,
        suggestions: cands.slice(0, 4),
      };
    });
  }, [result, inPlan, completed, sugSort, player, allowBoosts, includeQuestXp]);

  const toggleCompleted = useCallback((key: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAdded = useCallback((key: string) => {
    setAddedQuests((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearAdded = useCallback(() => setAddedQuests(new Set()), []);

  // ---- saved character slots: skills + quest progress stored under a name so
  // switching characters never re-hits Wise Old Man. Load = instant local swap.
  const upsertChar = useCallback((slot: CharSlot) => {
    setChars((prev) => {
      const i = prev.findIndex((c) => c.name.toLowerCase() === slot.name.toLowerCase());
      if (i >= 0) {
        const next = [...prev];
        next[i] = slot;
        return next;
      }
      return [...prev, slot];
    });
  }, []);

  /** merge a fresh skills payload into a slot without touching its quest progress */
  const upsertPlayerSkills = useCallback(
    (name: string, data: PlayerSkills) => {
      setChars((prev) => {
        const i = prev.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], player: data, savedAt: new Date().toISOString() };
          return next;
        }
        return [
          ...prev,
          { name, player: data, completed: [], questPoints: 0, added: [], targets: [], savedAt: new Date().toISOString() },
        ];
      });
    },
    [],
  );

  const saveCurrentChar = useCallback(() => {
    const name = (username.trim() || player?.username || "").trim();
    if (!name) return;
    upsertChar({
      name,
      player,
      completed: [...completed],
      questPoints: totalQuestPoints(completed),
      added: [...addedQuests],
      targets: [...targetKeys],
      savedAt: new Date().toISOString(),
    });
    toast({
      title: `Saved ${name}`,
      description: "Skills, quest progress and plan stored locally — load it anytime without re-importing.",
    });
  }, [username, player, completed, addedQuests, targetKeys, upsertChar, toast]);

  const loadChar = useCallback(
    (c: CharSlot) => {
      setPlayer(c.player);
      setCompleted(new Set(c.completed));
      setAddedQuests(new Set(c.added));
      setTargetKeys(c.targets ?? []);
      setUsername(c.name);
      // mirror the backup-restore persistence (player/username/targets bypass effects)
      if (c.player) localStorage.setItem("osrs-qp-player", JSON.stringify(c.player));
      else localStorage.removeItem("osrs-qp-player");
      localStorage.setItem("osrs-qp-username", c.name);
      if (c.targets?.length) localStorage.setItem("osrs-qp-targets", JSON.stringify(c.targets));
      else localStorage.removeItem("osrs-qp-targets");
      toast({
        title: `Loaded ${c.name}`,
        description: "Restored skills, quest progress and plan instantly — no hiscores request needed.",
      });
    },
    [toast],
  );

  const refreshChar = useCallback(
    async (c: CharSlot) => {
      setRefreshingChar(c.name);
      try {
        const res = await fetch(`/api/player?username=${encodeURIComponent(c.name)}`);
        const data = await res.json();
        if (!res.ok) {
          toast({ title: "Refresh failed", description: data.error ?? "Import failed", variant: "destructive" });
          return;
        }
        upsertPlayerSkills(c.name, data);
        // if this slot is the active session, live-update the skills too
        const activeName = (username.trim() || player?.username || "").toLowerCase();
        if (activeName && activeName === c.name.toLowerCase()) {
          setPlayer(data);
          localStorage.setItem("osrs-qp-player", JSON.stringify(data));
        }
        toast({
          title: `Updated ${c.name}`,
          description: `Fresh skills from ${data.source === "wiseoldman" ? "Wise Old Man" : "the hiscores"} saved to the slot.`,
        });
      } catch {
        toast({ title: "Network error", description: "Could not reach the hiscores.", variant: "destructive" });
      } finally {
        setRefreshingChar(null);
      }
    },
    [toast, upsertPlayerSkills, username, player],
  );

  const deleteChar = useCallback(
    (name: string) => {
      setChars((prev) => prev.filter((c) => c.name !== name));
      toast({ title: `Removed ${name}`, description: "The saved slot is gone — your current session is untouched." });
    },
    [toast],
  );

  // ---- character restore files: slots live in localStorage, which a cleared
  // cookie jar takes with it — per-character .json exports are the off-ramp.
  const exportChar = useCallback(
    (c: CharSlot) => {
      const json = JSON.stringify(
        { app: "quest-pathfinder", kind: "character", version: 2, exportedAt: new Date().toISOString(), data: c },
        null,
        2,
      );
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quest-pathfinder-character-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast({
        title: `Exported ${c.name}`,
        description: "A restore file for this character — re-import it after clearing cookies or on another device.",
      });
    },
    [toast],
  );

  const charFileRef = useRef<HTMLInputElement>(null);

  const onCharFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = ""; // allow re-importing the same file later
      if (!f) return;
      try {
        const parsed = JSON.parse(await f.text()) as {
          app?: string;
          kind?: string;
          // `target`/absent `targets`+`questPoints` = v1 character files
          data?: Partial<CharSlot> & { target?: string; questPoints?: number; player?: unknown };
        };
        const d = parsed?.data;
        if (
          parsed?.app !== "quest-pathfinder" ||
          parsed?.kind !== "character" ||
          !d ||
          typeof d.name !== "string" ||
          !d.name.trim()
        ) {
          toast({
            title: "Import failed",
            description: "That file isn't a Quest Pathfinder character export.",
            variant: "destructive",
          });
          return;
        }
        const rp = d.player as (PlayerSkills & Record<string, unknown>) | null | undefined;
        const player: PlayerSkills | null =
          rp && typeof rp === "object" && rp.levels && typeof rp.levels === "object"
            ? {
                ...rp,
                levels: (rp.levels as PlayerSkills["levels"]) ?? {},
                xp: (rp.xp as PlayerSkills["xp"]) ?? {},
                combatLevel: typeof rp.combatLevel === "number" ? rp.combatLevel : 3,
                source: typeof rp.source === "string" ? rp.source : "manual",
              }
            : null;
        const cleanKeys = (v: unknown): string[] =>
          Array.isArray(v)
            ? [...new Set(v.filter((k): k is string => typeof k === "string" && !!QUEST_BY_KEY[k]))]
            : [];
        const rawTargets = Array.isArray(d.targets)
          ? d.targets
          : d.target != null
            ? [d.target] // v1 character files stored a single target
            : [];
        const completedKeys = cleanKeys(d.completed);
        const slot: CharSlot = {
          name: d.name.trim(),
          player,
          completed: completedKeys,
          questPoints:
            typeof d.questPoints === "number" && d.questPoints >= 0
              ? Math.floor(d.questPoints)
              : totalQuestPoints(completedKeys),
          added: cleanKeys(d.added),
          targets: [
            ...new Set(
              rawTargets.filter(
                (k): k is string => typeof k === "string" && isValidTargetKey(k),
              ),
            ),
          ],
          savedAt: typeof d.savedAt === "string" ? d.savedAt : new Date().toISOString(),
        };
        upsertChar(slot);
        toast({
          title: `Imported ${slot.name}`,
          description: "Added to your saved characters — click the chip to load it.",
        });
      } catch {
        toast({
          title: "Import failed",
          description: "Couldn't read that file as JSON.",
          variant: "destructive",
        });
      }
    },
    [toast, upsertChar],
  );

  // ---- actions
  const importPlayer = useCallback(async () => {
    const name = username.trim();
    if (!name) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch(`/api/player?username=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!res.ok) {
        setImportMsg({ ok: false, text: data.error ?? "Import failed" });
      } else {
        setPlayer(data);
        localStorage.setItem("osrs-qp-player", JSON.stringify(data));
        localStorage.setItem("osrs-qp-username", name);
        // auto-save the slot so the next visit loads instantly (no WOM round-trip)
        upsertPlayerSkills(data.username ?? name, data);
        setImportMsg({ ok: true, text: `Imported ${data.username} (${data.source === "wiseoldman" ? "Wise Old Man" : "hiscores"}, combat ${data.combatLevel})` });
      }
    } catch {
      setImportMsg({ ok: false, text: "Network error — could not reach the hiscores." });
    } finally {
      setImporting(false);
    }
  }, [username, upsertPlayerSkills]);

  // ---- add-suggestion flow: extras never silently skip prereqs — and never
  // silently sign you up for hours of skill grinding either. If the quest has
  // gate quests outside the plan we require a one-time ack and ALWAYS add the
  // full transitive closure; if it has unmet skill requirements we show the
  // missing XP + rough training hours before adding.
  const requestAdd = useCallback(
    (key: string) => {
      if (addedQuests.has(key)) {
        toggleAdded(key); // removing — no warning needed
        return;
      }
      const missing = missingPrereqClosure(key, completed, inPlan);
      const q = QUEST_BY_KEY[key];
      const skillGaps = q
        ? questSkillGaps(q, player ?? DEFAULT_PLAYER, { allowBoosts, includeQuestXp }).filter(
            (g) => g.status === "train",
          )
        : [];
      if (missing.length === 0 && skillGaps.length === 0) {
        toggleAdded(key);
        return;
      }
      setPendingAdd({ questKey: key, missing, skillGaps });
    },
    [addedQuests, completed, inPlan, toggleAdded, player, allowBoosts, includeQuestXp],
  );

  const confirmPendingAdd = useCallback(() => {
    if (!pendingAdd) return;
    // single state update -> resolver recomputes the optimal order once,
    // splicing the new quests in by XP and crediting them downstream
    setAddedQuests((prev) => new Set([...prev, pendingAdd.questKey, ...pendingAdd.missing]));
    setPendingAdd(null);
  }, [pendingAdd]);

  // ---- backup / restore
  const buildBackupJson = useCallback(
    () =>
      JSON.stringify(
        {
          app: "quest-pathfinder",
          version: 2,
          exportedAt: new Date().toISOString(),
          data: {
            completed: [...completed],
            questPoints: totalQuestPoints(completed),
            added: [...addedQuests],
            targets: [...targetKeys],
            allowBoosts,
            includeQuestXp,
            manualQp: typeof manualQp === "number" ? manualQp : null,
            username,
            player,
          },
        },
        null,
        2,
      ),
    [completed, addedQuests, targetKeys, allowBoosts, includeQuestXp, manualQp, username, player],
  );

  const downloadBackup = useCallback(() => {
    const blob = new Blob([buildBackupJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quest-pathfinder-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast({
      title: "Backup downloaded",
      description: "Keep the file somewhere safe — it restores everything on any device.",
    });
  }, [buildBackupJson, toast]);

  const copyBackup = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildBackupJson());
      toast({
        title: "Copied to clipboard",
        description: "Paste it into a note — restore it later from this same dialog.",
      });
    } catch {
      toast({
        title: "Clipboard blocked",
        description: "Your browser denied clipboard access — use Download instead.",
        variant: "destructive",
      });
    }
  }, [buildBackupJson, toast]);

  const onBackupFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportFileName(f.name);
    f.text().then((t) => {
      setImportRaw(t);
      setBackupMsg(null);
    });
  };

  const applyImport = useCallback(() => {
    const parsed = parseBackup(importRaw);
    if (!parsed.ok) {
      setBackupMsg({ ok: false, text: parsed.text });
      return;
    }
    const d = parsed.data;
    setCompleted(new Set(d.completed));
    setAddedQuests(new Set(d.added));
    setTargetKeys(d.targets);
    setAllowBoosts(d.allowBoosts);
    setIncludeQuestXp(d.includeQuestXp);
    setManualQp(d.manualQp);
    setUsername(d.username);
    setPlayer(d.player);
    // player/username are written outside the effect-based persistence — mirror importPlayer
    if (d.player) localStorage.setItem("osrs-qp-player", JSON.stringify(d.player));
    if (d.username) localStorage.setItem("osrs-qp-username", d.username);
    else localStorage.removeItem("osrs-qp-username");
    if (d.targets.length) localStorage.setItem("osrs-qp-targets", JSON.stringify(d.targets));
    else localStorage.removeItem("osrs-qp-targets");
    setBackupOpen(false);
    setImportRaw("");
    setImportFileName(null);
    setBackupMsg(null);
    toast({
      title: "Data restored",
      description: `${d.completed.length} completed quest${d.completed.length === 1 ? "" : "s"} and ${d.added.length} plan addition${d.added.length === 1 ? "" : "s"} are back.`,
    });
  }, [importRaw, toast]);

  const markAllInChain = useCallback(() => {
    if (!result) return;
    setCompleted((prev) => {
      const next = new Set(prev);
      for (const s of result.steps) next.add(s.quest.key);
      for (const t of result.targets) next.add(t.quest.key);
      return next;
    });
  }, [result]);

  const copyChecklist = useCallback(() => {
    if (!result) return;
    const total =
      result.steps.reduce((a, s) => a + (questMinutes(s.quest) ?? 0), 0) +
      result.targets.reduce((a, t) => a + (questMinutes(t.quest) ?? 0), 0);
    const lines = [
      `Quest path to ${result.targets.map((t) => t.quest.name).join(" + ")} (${result.steps.length} quests, ≈${formatMinutes(total)})`,
      ...result.steps.map((s, i) => {
        const train = s.gaps.filter((g) => g.status === "train");
        const min = questMinutes(s.quest);
        const time = min !== null ? ` (≈${formatMinutes(min)})` : "";
        const suffix = train.length
          ? `  [train: ${train.map((g) => `${g.skill} ${g.required}`).join(", ")}]`
          : "";
        return `${i + 1}. ${s.quest.name}${s.isExtra ? " (added for XP)" : ""}${time}${suffix}`;
      }),
      ...result.targets.map(
        (t, i) => `${result.steps.length + i + 1}. ${t.quest.name}  <-- TARGET`,
      ),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
  }, [result]);

  const grouped = useMemo(() => {
    const byDiff = new Map<string, typeof QUESTS>();
    for (const q of [...QUESTS].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!byDiff.has(q.difficulty)) byDiff.set(q.difficulty, []);
      byDiff.get(q.difficulty)!.push(q);
    }
    return DIFF_ORDER.filter((d) => byDiff.has(d)).map((d) => [d, byDiff.get(d)!] as const);
  }, []);

  // single-target view of the picker trigger
  const firstTarget =
    targetKeys.length === 1
      ? targetKeys[0] === QUEST_CAPE_KEY
        ? QUEST_CAPE_QUEST
        : QUEST_BY_KEY[targetKeys[0]] ?? null
      : null;

  // animated stat numbers
  const cTotal = useCountUp(planQuests.size);
  const cGated = useCountUp(stepsNeedingTraining + targetsNeedingTraining);
  const cXp = useCountUp(result ? totalXpNeeded : 0, 800);
  const cTime = useCountUp(planMinutes, 700);
  const cQp = useCountUp(result?.estQp ?? 0);

  return (
    <MotionConfig reducedMotion="user">
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex flex-col bg-[radial-gradient(ellipse_at_top,#1c1917_0%,#0c0a09_60%)]">
        {/* header */}
        <header className="border-b border-amber-900/30 bg-stone-950/80 backdrop-blur sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-yellow-700 grid place-items-center shadow-lg shadow-amber-900/30 qa-glow">
              <img src="https://oldschool.runescape.wiki/images/Quest_point_icon.png" alt="" className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-amber-200">
                <span className="qa-shimmer">Quest Pathfinder</span>
              </h1>
              <p className="text-xs text-stone-400">
                OSRS prerequisite planner — {QUESTS.length} quests · data: osrs-db (MIT) + OSRS Wiki
              </p>
            </div>
            {player && (
              <Badge variant="outline" className="border-emerald-700/60 text-emerald-300 hidden sm:inline-flex">
                {player.username} · cb {player.combatLevel}
              </Badge>
            )}
            <Link
              href="/completions"
              aria-label="Set up your quest completions"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-700 px-3 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
            >
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Completions</span>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBackupMsg(null);
                setBackupOpen(true);
              }}
              className="border-stone-700 text-stone-300 hover:bg-stone-800 shrink-0 transition-transform active:scale-[0.97]"
              aria-label="Backup or restore your data"
            >
              <HardDriveDownload className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Backup</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 space-y-6">
          {/* import + target row */}
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            {/* character import */}
            <Card className="border-stone-800 bg-stone-900/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-stone-200">1 · Import your character</CardTitle>
                <CardDescription className="text-xs">
                  Skills load from Wise Old Man / official hiscores. Quest completion is tracked locally below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Username (e.g. Zezima)"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && importPlayer()}
                    className="bg-stone-950 border-stone-700 focus-visible:ring-amber-600"
                  />
                  <Button onClick={importPlayer} disabled={importing || !username.trim()} className="bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold transition-transform active:scale-[0.97]">
                    {importing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {importing ? "Loading…" : "Import"}
                  </Button>
                </div>
                {importMsg && (
                  <p className={`text-xs ${importMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{importMsg.text}</p>
                )}
                {player && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {Object.entries(player.levels)
                      .filter(([, lv]) => lv > 1)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 12)
                      .map(([skill, lv], idx) => (
                        <Badge key={skill} variant="secondary" className="qa-pop-in bg-stone-800 text-stone-300 text-[10px]" style={{ animationDelay: `${Math.min(idx * 45, 360)}ms` }}>
                          {skill} {lv}
                        </Badge>
                      ))}
                    <span className="text-[10px] text-stone-500 self-center">…</span>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Label htmlFor="qp-input" className="text-xs text-stone-400 whitespace-nowrap">
                    Current quest points
                  </Label>
                  <Input
                    id="qp-input"
                    type="number"
                    min={0}
                    max={500}
                    placeholder="auto"
                    value={manualQp}
                    onChange={(e) => setManualQp(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="h-8 w-24 bg-stone-950 border-stone-700 focus-visible:ring-amber-600"
                  />
                  <span className="text-[10px] text-stone-600">optional — sharpens QP gates</span>
                </div>

                {/* saved character slots — instant local switching, no WOM round-trip */}
                <div className="pt-1">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <Label className="text-xs text-stone-400">Saved characters</Label>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => charFileRef.current?.click()}
                        className="h-6 px-2 text-[10px] text-stone-400 hover:text-sky-200 hover:bg-stone-800"
                        title="Add characters from exported .json restore files"
                      >
                        <FileUp className="h-3 w-3" aria-hidden />
                        Import file
                      </Button>
                      <input
                        ref={charFileRef}
                        type="file"
                        accept="application/json,.json"
                        className="sr-only"
                        onChange={onCharFile}
                        aria-label="Import character file"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={saveCurrentChar}
                        disabled={!username.trim() && !player}
                        className="h-6 px-2 text-[10px] text-amber-300/90 hover:text-amber-200 hover:bg-stone-800 disabled:opacity-40"
                        title="Store your current skills, quest progress and plan under this name"
                      >
                        <UserPlus className="h-3 w-3" aria-hidden />
                        Save current
                      </Button>
                    </div>
                  </div>
                  {chars.length === 0 ? (
                    <p className="text-[10px] text-stone-600">
                      Import once, save, then switch characters instantly — hiscores are only hit on
                      import / refresh. Export a slot with ↧ to keep it safe from cleared cookies.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {chars.map((c) => {
                        const activeName = (player?.username ?? username.trim()).toLowerCase();
                        const active = !!activeName && activeName === c.name.toLowerCase();
                        return (
                          <div
                            key={c.name}
                            className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 text-[11px] transition-colors ${
                              active
                                ? "border-emerald-700/70 bg-emerald-950/30 text-emerald-200"
                                : "border-stone-700 bg-stone-950/70 text-stone-300"
                            }`}
                          >
                            <button
                              onClick={() => loadChar(c)}
                              title={`Load ${c.name} · ${c.player ? `cb ${c.player.combatLevel}` : "no skills yet"} · ${c.completed.length} quest${c.completed.length === 1 ? "" : "s"} done · ≈${c.questPoints} QP · saved ${new Date(c.savedAt).toLocaleDateString()}`}
                              className="inline-flex items-center gap-1 font-medium hover:text-amber-200"
                            >
                              {active && <Check className="h-3 w-3 text-emerald-400" aria-hidden />}
                              {c.name}
                            </button>
                            <button
                              onClick={() => refreshChar(c)}
                              disabled={refreshingChar === c.name}
                              title={`Update ${c.name}&apos;s skills from Wise Old Man`}
                              aria-label={`Update ${c.name} from Wise Old Man`}
                              className="grid h-4 w-4 place-items-center rounded-full text-stone-500 hover:bg-stone-800 hover:text-sky-300 disabled:opacity-40"
                            >
                              {refreshingChar === c.name ? (
                                <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
                              ) : (
                                <RefreshCw className="h-2.5 w-2.5" aria-hidden />
                              )}
                            </button>
                            <button
                              onClick={() => exportChar(c)}
                              title={`Export ${c.name} as a .json restore file`}
                              aria-label={`Export ${c.name} as a restore file`}
                              className="grid h-4 w-4 place-items-center rounded-full text-stone-500 hover:bg-stone-800 hover:text-amber-300"
                            >
                              <Download className="h-2.5 w-2.5" aria-hidden />
                            </button>
                            <button
                              onClick={() => deleteChar(c.name)}
                              title={`Remove ${c.name}`}
                              aria-label={`Remove saved character ${c.name}`}
                              className="grid h-4 w-4 place-items-center rounded-full text-stone-500 hover:bg-stone-800 hover:text-red-400"
                            >
                              <X className="h-2.5 w-2.5" aria-hidden />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* target quest picker */}
            <Card className="border-amber-900/40 bg-stone-900/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-stone-200">2 · Track target quests</CardTitle>
                <CardDescription className="text-xs">
                  Add one or more — the merged prerequisite tree is resolved and ordered for you.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={pickerOpen}
                      className="w-full justify-between bg-stone-950 border-stone-700 hover:bg-stone-800 h-auto py-2.5 text-left"
                    >
                      {targetKeys.length === 0 ? (
                        <span className="text-stone-500">Search {QUESTS.length} quests…</span>
                      ) : targetKeys.length === 1 && firstTarget ? (
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-medium text-stone-100">{firstTarget.name}</span>
                          <Badge className={`text-[10px] border ${DIFF_COLORS[firstTarget.difficulty]}`}>{firstTarget.difficulty}</Badge>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="shrink-0 font-medium text-stone-100">{targetKeys.length} quests tracked</span>
                          <span className="truncate text-[11px] text-stone-500">
                            {targetKeys
                              .slice(0, 2)
                              .map((k) =>
                                k === QUEST_CAPE_KEY ? QUEST_CAPE_QUEST.name : QUEST_BY_KEY[k]?.name,
                              )
                              .filter(Boolean)
                              .join(", ")}…
                          </span>
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(28rem,80vw)] p-0 bg-stone-900 border-stone-700" align="start">
                    <Command>
                      <CommandInput placeholder="Search quests…" className="text-stone-100" />
                      <CommandList className="max-h-72">
                        <CommandEmpty>No quest found.</CommandEmpty>
                        <CommandGroup heading="Goals">
                          <CommandItem
                            key={QUEST_CAPE_KEY}
                            value="Quest Cape all quests miniquest plan everything"
                            onSelect={() => addTargetKey(QUEST_CAPE_KEY)}
                            className="text-amber-200 aria-selected:bg-amber-900/40"
                          >
                            {targetKeys.includes(QUEST_CAPE_KEY) && (
                              <Check className="mr-1.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                            )}
                            <span className="truncate flex-1">
                              Quest Cape — every quest &amp; miniquest
                            </span>
                          </CommandItem>
                        </CommandGroup>
                        {grouped.map(([diff, quests]) => (
                          <CommandGroup key={diff} heading={diff} className="text-stone-400">
                            {quests.map((q) => (
                              <CommandItem
                                key={q.key}
                                value={`${q.name} ${q.difficulty}`}
                                onSelect={() => addTargetKey(q.key)}
                                className="text-stone-200 aria-selected:bg-amber-900/40"
                              >
                                {targetKeys.includes(q.key) && (
                                  <Check className="mr-1.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                                )}
                                <span className="truncate flex-1">{q.name}</span>
                                {q.f2p && <Badge variant="secondary" className="text-[9px] bg-stone-800">F2P</Badge>}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {/* tracked targets — remove individually or clear all */}
                {targetKeys.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5" role="list" aria-label="Tracked target quests">
                    {targetKeys.map((k) => {
                      const q = k === QUEST_CAPE_KEY ? QUEST_CAPE_QUEST : QUEST_BY_KEY[k];
                      if (!q) return null;
                      const done = completed.has(k);
                      return (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-700/70 bg-amber-500/10 py-0.5 pl-2 pr-1 text-[11px] text-amber-200"
                        >
                          {done && <Check className="h-3 w-3 text-emerald-400" aria-hidden />}
                          <span className="max-w-[170px] truncate">{q.name}</span>
                          <button
                            type="button"
                            onClick={() => removeTargetKey(k)}
                            aria-label={`Stop tracking ${q.name}`}
                            className="grid h-4 w-4 place-items-center rounded-full text-amber-300/70 hover:bg-amber-900/60 hover:text-amber-100"
                          >
                            <X className="h-2.5 w-2.5" aria-hidden />
                          </button>
                        </span>
                      );
                    })}
                    {targetKeys.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setTargetKeys([])}
                        className="self-center text-[10px] text-stone-500 underline underline-offset-2 hover:text-red-300"
                      >
                        clear all
                      </button>
                    )}
                  </div>
                )}

                {/* one-click popular goals */}
                <div className="mt-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="h-3 w-3 text-amber-400/90" aria-hidden />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                      Popular goals
                    </span>
                  </div>
                  <div
                    role="group"
                    aria-label="Popular goal presets — one click adds it to your tracked targets"
                    className="flex flex-wrap gap-1.5"
                  >
                    {GOAL_PRESETS.map((p) => {
                      const q = p.key === QUEST_CAPE_KEY ? QUEST_CAPE_QUEST : QUEST_BY_KEY[p.key];
                      if (!q) return null;
                      const active = targetKeys.includes(p.key);
                      const done = completed.has(p.key);
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => addTargetKey(p.key)}
                          aria-pressed={active}
                          title={
                            p.key === QUEST_CAPE_KEY
                              ? `Every quest & miniquest (${QUESTS.length} entries) — one click adds it to your tracked targets`
                              : `${q.name} · ${q.difficulty}${q.qp ? ` · ${q.qp} QP required` : ""}${done ? " · already completed" : ""}`
                          }
                          className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-all active:scale-[0.97] ${
                            active
                              ? "border-amber-500 bg-amber-500/15 text-amber-200 shadow-[0_0_12px_rgba(217,119,6,0.28)]"
                              : "border-stone-700 bg-stone-950/80 text-stone-300 hover:border-amber-700/70 hover:bg-stone-900 hover:text-amber-200"
                          }`}
                        >
                          {done && <Check className="h-3 w-3 text-emerald-400" aria-hidden />}
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-xs text-stone-300">Allow boosts for boostable reqs</Label>
                      <p className="text-[10px] text-stone-500">Potions/stews count as meeting the level</p>
                    </div>
                    <Switch checked={allowBoosts} onCheckedChange={setAllowBoosts} />
                  </div>
                  <Separator className="bg-stone-800" />
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-xs text-stone-300">Factor quest-given XP</Label>
                      <p className="text-[10px] text-stone-500">Earlier quest rewards can cover later requirements</p>
                    </div>
                    <Switch checked={includeQuestXp} onCheckedChange={setIncludeQuestXp} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* results */}
          {targetKeys.length === 0 && (
            <Card className="border-dashed border-stone-700 bg-stone-900/30">
              <CardContent className="py-14 text-center space-y-2">
                <p className="text-stone-300 font-medium">No targets tracked yet</p>
                <p className="text-xs text-stone-500 max-w-md mx-auto">
                  Add one or more quests above — e.g. <button className="underline hover:text-amber-300" onClick={() => addTargetKey("monkey madness ii")}>Monkey Madness II</button> or{" "}
                  <button className="underline hover:text-amber-300" onClick={() => addTargetKey("recipe for disaster")}>Recipe for Disaster</button> — and you&apos;ll get the full ordered prerequisite chain.
                </p>
              </CardContent>
            </Card>
          )}

          {result && (
            <motion.div key={targetKeys.join("|")} className="space-y-6">
              {/* summary strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { v: cTotal, label: "quests in your path", cls: "text-amber-300", xp: false, time: false },
                  { v: cGated, label: "gated by training", cls: "text-red-400", xp: false, time: false },
                  { v: cXp, label: "XP to train (est.)", cls: "text-emerald-400", xp: true, time: false },
                  { v: cTime, label: "est. playtime (quests)", cls: "text-sky-300", xp: false, time: true },
                  { v: cQp, label: result.qpRequired ? "quest points (est. / req)" : "quest points", cls: "text-stone-100", xp: false, time: false },
                ].map((s, i) => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.04 + i * 0.07, duration: 0.35, ease: "easeOut" }}
                  >
                    <Card className="border-stone-800 bg-stone-900/60">
                      <CardContent className="pt-4 pb-3 px-4">
                        <p className={`text-2xl font-bold ${s.cls}`}>
                          {s.time
                            ? `≈${formatMinutes(Math.round(s.v))}`
                            : s.xp
                              ? formatXp(s.v)
                              : Math.round(s.v)}
                          {s.label === "quest points (est. / req)" && result.qpRequired ? `/${result.qpRequired}` : ""}
                        </p>
                        <p className="text-[11px] text-stone-400">{s.label}</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              {/* training summary */}
              {result.skillTotals.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.32, duration: 0.35, ease: "easeOut" }}
                >
                <Card className="border-stone-800 bg-stone-900/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-stone-200">Training summary (what you actually need to grind)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {result.skillTotals.map((g) => (
                        <Badge key={g.skill} variant="outline" className={`${gapBadgeClass(g)} text-xs py-1`}>
                          {gapLabel(g)}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-[10px] text-stone-500 mt-3">
                      Quest-XP coverage and boostable requirements are excluded — these are the real grind targets.
                    </p>
                  </CardContent>
                </Card>
                </motion.div>
              )}

              {/* the chain */}
              <Card className="border-amber-900/40 bg-stone-900/60">
                <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm text-stone-200">Optimal prerequisite order</CardTitle>
                    <CardDescription className="text-xs">
                      Front-loads quests that unlock the most of your path; quest XP is credited in order.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex overflow-hidden rounded-md border border-stone-700" role="group" aria-label="Chain view mode">
                      <button
                        onClick={() => setViewMode("list")}
                        aria-pressed={viewMode === "list"}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          viewMode === "list"
                            ? "bg-amber-600 text-stone-950"
                            : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                        }`}
                      >
                        <List className="h-3.5 w-3.5" aria-hidden />
                        List
                      </button>
                      <button
                        onClick={() => setViewMode("graph")}
                        aria-pressed={viewMode === "graph"}
                        className={`flex items-center gap-1.5 border-l border-stone-700 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          viewMode === "graph"
                            ? "bg-amber-600 text-stone-950"
                            : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                        }`}
                      >
                        <Network className="h-3.5 w-3.5" aria-hidden />
                        Graph
                      </button>
                    </div>
                    <Button variant="outline" size="sm" onClick={copyChecklist} className="border-stone-700 text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97]">
                      Copy checklist
                    </Button>
                    <Button variant="outline" size="sm" onClick={markAllInChain} className="border-stone-700 text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97]">
                      Mark all done
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* plan progress */}
                  <div className="flex items-center gap-3" aria-label={`Plan progress: ${planDone} of ${planQuests.size} complete`}>
                    <div className="h-1.5 flex-1 rounded-full bg-stone-800 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${planTotalPct}%` }}
                        transition={{ type: "spring", stiffness: 120, damping: 22 }}
                      />
                    </div>
                    <span className="text-[10px] text-stone-500 shrink-0 tabular-nums">
                      {planDone}/{planQuests.size} done
                    </span>
                  </div>
                  <UnmetRequirementsPanel entries={unmetEntries} totalTrainXp={totalXpNeeded} />
                  {viewMode === "graph" ? (
                    <QuestGraph
                      steps={result.steps}
                      targets={result.targets}
                      cascades={result.cascades}
                      completed={completed}
                      onToggleCompleted={toggleCompleted}
                    />
                  ) : (
                  <div className="qp-scroll max-h-[34rem] overflow-y-auto pr-3">
                    <ol className="space-y-1.5">
                      <AnimatePresence initial={false}>
                      {result.steps
                        .filter((step) => !result.targets.some((t) => t.quest.key === step.quest.key))
                        .map((step, i) => {
                        const q = step.quest;
                        const done = completed.has(q.key);
                        const trainGaps = step.gaps.filter((g) => g.status === "train");
                        return (
                          <motion.li
                            layout
                            key={q.key}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, transition: { duration: 0.15 } }}
                            transition={{
                              delay: Math.min(i * 0.035, 0.45),
                              duration: 0.3,
                              ease: "easeOut",
                              layout: { duration: 0.3, ease: "easeInOut" },
                            }}
                          >
                            <div className={`flex items-start gap-2 rounded-md border px-3 py-2 transition-all duration-200 hover:border-amber-900/60 hover:bg-stone-900/60 ${done ? "border-emerald-900/50 bg-emerald-950/20 opacity-70" : step.isExtra ? "border-sky-900/50 bg-sky-950/20" : step.needsTraining ? "border-red-900/40 bg-stone-950/40" : "border-stone-800/60 bg-stone-950/20"}`}>
                              <span className="text-xs font-mono text-stone-500 w-6 pt-1.5 text-right shrink-0">{i + 1}.</span>
                              <Checkbox
                                checked={done}
                                onCheckedChange={() => toggleCompleted(q.key)}
                                aria-label={`Mark ${q.name} complete`}
                                className="mt-1.5 border-stone-600 data-[state=checked]:bg-emerald-700 data-[state=checked]:border-emerald-700"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <a
                                    href={wikiUrl(q.name)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`text-sm font-medium hover:text-amber-300 hover:underline ${done ? "line-through text-stone-500" : "text-stone-100"}`}
                                  >
                                    {q.name}
                                  </a>
                                  <Badge className={`text-[9px] px-1.5 border ${DIFF_COLORS[q.difficulty]}`}>{q.difficulty}</Badge>
                                  {!q.f2p && <Badge variant="secondary" className="text-[9px] px-1.5 bg-stone-800 text-stone-400">P2P</Badge>}
                                  {questMinutes(q) !== null && (
                                    <span
                                      className="inline-flex items-center gap-0.5 text-[9px] text-stone-500"
                                      title="Estimated playtime from the wiki quest length"
                                    >
                                      <Clock className="h-2.5 w-2.5" aria-hidden />
                                      ≈{formatMinutes(questMinutes(q)!)}
                                    </span>
                                  )}
                                  {step.isExtra && (
                                    <Badge className="text-[9px] px-1.5 bg-sky-950/60 text-sky-300 border border-sky-800/50">
                                      added for XP
                                    </Badge>
                                  )}
                                  {step.unlocks > 0 && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="secondary" className="text-[9px] px-1.5 bg-amber-950/60 text-amber-300 border border-amber-800/50">
                                          unlocks {step.unlocks}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent sideOffset={6} arrowClassName={TOOLTIP_ARROW} className={`text-xs px-3 py-2 leading-relaxed ${TOOLTIP_BOX}`}>
                                        {step.unlocks === 1 ? "1 more quest" : `${step.unlocks} more quests`} in your path depend on this
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                  {trainGaps.length > 0 && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge className="text-[9px] px-1.5 bg-red-950/60 text-red-300 border border-red-800/50">
                                          ⚒ train {trainGaps.map((g) => `${g.skill} +${g.deficit}`).join(", ")}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent sideOffset={6} arrowClassName={TOOLTIP_ARROW} className={`text-xs max-w-xs px-3 py-2.5 leading-relaxed ${TOOLTIP_BOX}`}>
                                        Gated by unmet skill levels — train these before attempting this quest.
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                  {Object.keys(q.xp).length > 0 && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="secondary" className="text-[9px] px-1.5 bg-emerald-950/40 text-emerald-300/90 border border-emerald-800/40">
                                          +XP {Object.entries(q.xp).map(([s, x]) => `${s} ${formatXp(x)}`).join(" · ")}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent sideOffset={6} arrowClassName={TOOLTIP_ARROW} className={`text-xs px-3 py-2 leading-relaxed ${TOOLTIP_BOX}`}>Quest experience rewards</TooltipContent>
                                    </Tooltip>
                                  )}
                                  {step.isExtra && step.missingPrereqs && step.missingPrereqs.length > 0 && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge className="text-[9px] px-1.5 bg-amber-950/50 text-amber-300 border border-amber-800/50">
                                          ⚠ {step.missingPrereqs.length} prereq{step.missingPrereqs.length > 1 ? "s" : ""} not in plan
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent sideOffset={6} arrowClassName={TOOLTIP_ARROW} className={`text-xs max-w-sm px-3 py-2.5 leading-relaxed ${TOOLTIP_BOX}`}>
                                        You still need: {step.missingPrereqs.slice(0, 5).map((k) => QUEST_BY_KEY[k]?.name ?? k).join(", ")}{step.missingPrereqs.length > 5 ? "…" : ""}
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                  {step.isExtra && (
                                    <button
                                      onClick={() => toggleAdded(q.key)}
                                      className="text-[10px] text-stone-500 hover:text-red-300 underline underline-offset-2"
                                    >
                                      remove
                                    </button>
                                  )}
                                </div>
                                {/* every skill requirement of this quest — met or not */}
                                {step.requirements.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {step.requirements.map((g) => (
                                      <ReqChip key={g.skill} gap={g} />
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-stone-600 mt-1">no skill requirements</p>
                                )}
                                {step.qpReq !== null && (
                                  <div className="mt-1.5">
                                    <Badge variant="outline" className={`text-[10px] ${result.estQp >= step.qpReq ? "bg-emerald-900/60 text-emerald-300 border-emerald-600/50" : "bg-red-900/60 text-red-300 border-red-600/50"}`}>
                                      {step.qpReq} quest points {result.estQp >= step.qpReq ? "✓" : `(have ~${result.estQp})`}
                                    </Badge>
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.li>
                        );
                      })}
                      </AnimatePresence>
                      {/* target rows — one per tracked quest */}
                      {result.targets.map((t, ti) => (
                        <motion.li
                          key={t.quest.key}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.5, duration: 0.35, ease: "easeOut" }}
                          className="list-none"
                        >
                        <div className="flex items-start gap-2 rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2.5 qa-target-pulse">
                          <span className="text-xs font-mono text-amber-500 w-6 pt-0.5 text-right shrink-0">🎯</span>
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                            <Checkbox
                              checked={completed.has(t.quest.key)}
                              onCheckedChange={() => toggleCompleted(t.quest.key)}
                              aria-label={`Mark ${t.quest.name} complete`}
                              className="border-amber-600 data-[state=checked]:bg-amber-600"
                            />
                            <a href={wikiUrl(t.quest.name)} target="_blank" rel="noreferrer" className="text-sm font-bold text-amber-200 hover:underline">
                              {t.quest.name}
                            </a>
                            <Badge className={`text-[9px] px-1.5 border ${DIFF_COLORS[t.quest.difficulty]}`}>{t.quest.difficulty}</Badge>
                            {questMinutes(t.quest) !== null && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-500/80">
                                <Clock className="h-2.5 w-2.5" aria-hidden />
                                ≈{formatMinutes(questMinutes(t.quest)!)}
                              </span>
                            )}
                            <span className="text-[10px] text-amber-500/80">
                              — target{result.targets.length > 1 ? ` ${ti + 1} of ${result.targets.length}` : ""}, everything above feeds into this
                            </span>
                            {t.requirements.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1 w-full">
                                {t.requirements.map((g) => (
                                  <ReqChip key={g.skill} gap={g} />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        </motion.li>
                      ))}
                    </ol>
                  </div>
                  )}
                </CardContent>
              </Card>

              {/* skill-raising quest suggestions (not applicable in Quest Cape mode) */}
              {!isCape && suggestionGroups.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.42, duration: 0.35, ease: "easeOut" }}
                >
                <SkillSuggestionsPanel
                  groups={suggestionGroups}
                  addedKeys={addedQuests}
                  onToggle={requestAdd}
                  onClearAdded={clearAdded}
                  sortBy={sugSort}
                  onSortChange={setSugSort}
                />
                </motion.div>
              )}

              {/* footer actions */}
              <p className="text-[10px] text-stone-600">
                Requirements data: OSRS Wiki (boostability &amp; start-flags) · quest registry: wvanderp/osrs-db · completion stored locally in your browser — set it up in bulk on the{" "}
                <Link href="/completions" className="underline underline-offset-2 hover:text-stone-400">
                  Completions
                </Link>{" "}
                page
              </p>
            </motion.div>
          )}
        </main>

        <footer className="border-t border-stone-900 mt-auto">
          <div className="max-w-6xl mx-auto px-4 py-3 text-[10px] text-stone-600 flex flex-wrap justify-between gap-2">
            <span>Unofficial tool. RuneScape and OSRS are trademarks of Jagex Ltd.</span>
            <span>{completed.size} quests marked complete · saved locally — use Backup to export</span>
            <span className="tabular-nums" title="Deployed build — matches the GHCR image tag">
              {APP_VERSION} · build {APP_BUILD}
            </span>
          </div>
        </footer>
      </div>

      {/* add-with-prereqs / skill-requirements acknowledgment — one-time ack */}
      <AlertDialog open={!!pendingAdd} onOpenChange={(o) => { if (!o) setPendingAdd(null); }}>
        <AlertDialogContent className="bg-stone-900 border-stone-700 max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-stone-100">
              {pendingAdd && pendingAdd.missing.length === 0
                ? `Add ${QUEST_BY_KEY[pendingAdd.questKey]?.name ?? "this quest"} despite unmet skills?`
                : `Add ${pendingAdd ? QUEST_BY_KEY[pendingAdd.questKey]?.name : ""} + ${pendingAdd?.missing.length ?? 0} prerequisite${pendingAdd?.missing.length === 1 ? "" : "s"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-stone-400">
              {pendingAdd && pendingAdd.missing.length > 0 && (
                <>
                  This quest grants XP but isn&apos;t a true prerequisite of your target, and its
                  gate quests aren&apos;t in your plan yet. Prerequisites are always added — there
                  is no skip option — and the optimal order is recomputed so their quest XP counts
                  toward later requirements.
                </>
              )}
              {pendingAdd && pendingAdd.missing.length === 0 && (
                <>
                  This quest grants XP you want, but you don&apos;t meet its skill requirements
                  yet. Adding it is safe — the levels become training gates in your plan, nothing
                  is auto-trained.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingAdd && pendingAdd.missing.length > 0 && (
            <div
              className="max-h-44 overflow-y-auto rounded-md border border-stone-800 bg-stone-950/70 p-2 space-y-1"
              role="list"
              aria-label="Prerequisites to be added"
            >
              {pendingAdd.missing.map((k) => {
                const q = QUEST_BY_KEY[k];
                if (!q) return null;
                return (
                  <div key={k} role="listitem" className="flex items-center gap-2 text-xs">
                    <Badge className={`text-[9px] px-1.5 border ${DIFF_COLORS[q.difficulty]}`}>
                      {q.difficulty}
                    </Badge>
                    <a
                      href={wikiUrl(q.name)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-stone-200 truncate hover:text-amber-300 hover:underline"
                    >
                      {q.name}
                    </a>
                  </div>
                );
              })}
            </div>
          )}
          {pendingAdd && pendingAdd.skillGaps.length > 0 && (
            <div
              className="rounded-md border border-red-900/50 bg-red-950/20 p-2.5 space-y-1.5"
              role="list"
              aria-label="Unmet skill requirements"
            >
              <p className="text-xs font-semibold text-red-300">
                Unmet skill requirements ({pendingAdd.skillGaps.length})
              </p>
              {pendingAdd.skillGaps.map((g) => {
                const hrs = trainHours(g.skill, g.xpNeeded);
                return (
                  <div
                    key={`${g.skill}-${g.required}`}
                    role="listitem"
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                  >
                    <Badge variant="outline" className="text-[10px] px-1.5 bg-red-900/60 text-red-200 border-red-700/60">
                      {g.skill} {g.required}
                    </Badge>
                    <span className="text-stone-400">you: {g.base}</span>
                    <span className="text-red-300/90">
                      +{g.deficit} lv · ≈{formatXp(g.xpNeeded)} XP
                      {hrs !== null ? ` · ≈${formatHours(hrs)}` : ""}
                    </span>
                  </div>
                );
              })}
              <p className="text-[10px] text-stone-500">
                Hours are rough estimates at typical training rates — real times vary a lot by
                method. These levels show up as training gates in your plan.
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-stone-700 text-stone-300 hover:bg-stone-800 hover:text-stone-100">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPendingAdd}
              className="bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold"
            >
              {pendingAdd && pendingAdd.missing.length > 0
                ? `Accept all — add ${pendingAdd.missing.length + 1} quest${pendingAdd.missing.length + 1 === 1 ? "" : "s"}`
                : "Add anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* backup & restore */}
      <Dialog
        open={backupOpen}
        onOpenChange={(o) => {
          setBackupOpen(o);
          if (!o) setBackupMsg(null);
        }}
      >
        <DialogContent className="bg-stone-900 border-stone-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-stone-100">Backup &amp; restore your data</DialogTitle>
            <DialogDescription className="text-stone-400">
              Everything lives in this browser&apos;s local storage. Export a JSON snapshot so a
              cleared cache never costs you your progress.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-stone-300">Export</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={downloadBackup}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold transition-transform active:scale-[0.97]"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Download .json
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyBackup}
                  className="flex-1 border-stone-700 text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97]"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Copy JSON
                </Button>
              </div>
              <p className="text-[10px] text-stone-500">
                Includes completed quests, plan additions, settings, your QP override and the
                imported character.
              </p>
            </div>
            <Separator className="bg-stone-800" />
            <div className="space-y-2">
              <p className="text-xs font-medium text-stone-300">Restore</p>
              <label className="flex items-center gap-2 rounded-md border border-dashed border-stone-700 bg-stone-950/60 px-3 py-2.5 text-xs text-stone-300 cursor-pointer hover:border-stone-600 hover:bg-stone-900 transition-colors">
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={onBackupFile}
                  aria-label="Choose backup file"
                />
                <FileUp className="h-3.5 w-3.5 text-stone-500 shrink-0" aria-hidden />
                <span className="truncate">
                  {importFileName ?? "Choose a backup file…"}
                </span>
              </label>
              <Textarea
                value={importRaw}
                onChange={(e) => {
                  setImportRaw(e.target.value);
                  setBackupMsg(null);
                }}
                placeholder="…or paste backup JSON here"
                className="font-mono text-[10px] h-24 bg-stone-950 border-stone-700 focus-visible:ring-amber-600 resize-none"
              />
              {backupMsg && (
                <p className={`text-xs ${backupMsg.ok ? "text-emerald-400" : "text-red-400"}`} role="alert">
                  {backupMsg.text}
                </p>
              )}
              <Button
                size="sm"
                disabled={!importRaw.trim()}
                onClick={applyImport}
                className="w-full bg-emerald-700 hover:bg-emerald-600 text-stone-50 font-semibold transition-transform active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                Restore data
              </Button>
              <p className="text-[10px] text-stone-500">
                Restoring replaces your current completed list, plan, settings and character with
                the backup&apos;s contents. Unknown quest names are dropped.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
    </MotionConfig>
  );
}
