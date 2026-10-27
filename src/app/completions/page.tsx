"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DIFF_COLORS,
  QUESTS,
  QUEST_BY_KEY,
  questPointsAwarded,
  totalQuestPoints,
} from "@/lib/quest-data";
import {
  parseQuestStateExport,
  type ParsedQuestState,
} from "@/lib/quest-state-import";
import { APP_BUILD, APP_VERSION } from "@/lib/version";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  FileJson,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ utils */

const DIFF_ORDER = [
  "Novice", "Intermediate", "Experienced", "Master", "Grandmaster",
  "Special", "Miniquest", "Activity", "Unknown",
];

function wikiUrl(name: string) {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(name)
    .replace(/%2F/g, "/")
    .replace(/%20/g, "_")}`;
}

type StatusFilter = "all" | "todo" | "done";
type SortMode = "az" | "difficulty" | "release";

function releaseDate(q: { release: string | null }): number {
  if (!q.release) return 0;
  const t = Date.parse(q.release);
  return Number.isNaN(t) ? 0 : t;
}

/* ------------------------------------------------------------------ page */

export default function CompletionsPage() {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [difficulty, setDifficulty] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("az");
  const [pendingBulk, setPendingBulk] = useState<"check" | "uncheck" | null>(null);
  const hydrated = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ParsedQuestState | null>(null);
  const [pendingSync, setPendingSync] = useState(false);

  // ---- localStorage hydration / persistence (same key the planner uses)
  useEffect(() => {
    try {
      const c = localStorage.getItem("osrs-qp-completed");
      if (c) {
        const arr = JSON.parse(c);
        if (Array.isArray(arr)) {
          setCompleted(
            new Set(arr.filter((k): k is string => typeof k === "string" && !!QUEST_BY_KEY[k])),
          );
        }
      }
    } catch {
      /* ignore */
    }
    hydrated.current = true;
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    localStorage.setItem("osrs-qp-completed", JSON.stringify([...completed]));
  }, [completed]);

  const toggle = useCallback((key: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const difficultyKeys = useMemo(
    () => DIFF_ORDER.filter((d) => QUESTS.some((q) => q.difficulty === d)),
    [],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = QUESTS.filter((quest) => {
      if (q && !quest.name.toLowerCase().includes(q)) return false;
      if (difficulty !== "all" && quest.difficulty !== difficulty) return false;
      if (status === "done" && !completed.has(quest.key)) return false;
      if (status === "todo" && completed.has(quest.key)) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      switch (sort) {
        case "difficulty":
          return (
            DIFF_ORDER.indexOf(a.difficulty) - DIFF_ORDER.indexOf(b.difficulty) ||
            a.name.localeCompare(b.name)
          );
        case "release":
          return releaseDate(b) - releaseDate(a) || a.name.localeCompare(b.name);
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [query, difficulty, status, sort, completed]);

  const applyBulk = useCallback(() => {
    if (!pendingBulk) return;
    setCompleted((prev) => {
      const next = new Set(prev);
      if (pendingBulk === "check") {
        for (const q of visible) next.add(q.key);
      } else {
        for (const q of visible) next.delete(q.key);
      }
      return next;
    });
    setPendingBulk(null);
  }, [pendingBulk, visible]);

  // ---- RuneLite Quest State Exporter import -------------------------------
  const onImportFile = useCallback(
    async (file: File) => {
      let parsed: ParsedQuestState | null = null;
      try {
        parsed = parseQuestStateExport(JSON.parse(await file.text()));
      } catch {
        parsed = null;
      }
      if (!parsed) {
        toast({
          title: "Import failed",
          description:
            "That file doesn't look like a Quest State Exporter JSON export.",
          variant: "destructive",
        });
        return;
      }
      setImportPreview(parsed);
      toast({
        title: `Loaded ${file.name}`,
        description: `${parsed.finishedKeys.length} finished quests found — review the summary, then apply.`,
      });
    },
    [toast],
  );

  const applyImport = useCallback(
    (mode: "merge" | "sync") => {
      if (!importPreview) return;
      setCompleted((prev) => {
        const next = new Set(prev);
        if (mode === "sync") {
          for (const k of importPreview.notFinishedKeys) next.delete(k);
        }
        for (const k of importPreview.finishedKeys) next.add(k);
        return next;
      });
      setPendingSync(false);
      setImportPreview(null);
      toast({
        title: mode === "sync" ? "Completions synced to file" : "Finished quests marked",
        description:
          mode === "sync"
            ? `Set to match ${importPreview.rsn ?? "the file"}: ${importPreview.finishedKeys.length} checked, ${importPreview.notFinishedKeys.length} unchecked.`
            : `${importPreview.finishedKeys.length} quests marked complete.`,
      });
    },
    [importPreview, toast],
  );

  const doneCount = completed.size;
  const qp = totalQuestPoints(completed);
  const maxQp = useMemo(() => totalQuestPoints(QUESTS.map((q) => q.key)), []);
  const pct = Math.round((doneCount / Math.max(1, QUESTS.length)) * 100);

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1c1917_0%,#0c0a09_60%)]">
      {/* header */}
      <header className="border-b border-amber-900/30 bg-stone-950/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/"
            aria-label="Back to the planner"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2.5 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Planner</span>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-amber-200">Quest completions</h1>
            <p className="text-xs text-stone-400">
              Set everything you&apos;ve already finished — the planner uses it to trim your paths.
            </p>
          </div>
        </div>
      </header>

      <main className="w-full max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* progress */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-bold text-amber-300 tabular-nums">
                {doneCount}
                <span className="text-sm font-medium text-stone-500">/{QUESTS.length}</span>
              </span>
              <span className="text-sm text-stone-400">quests marked complete</span>
              <span className="text-sm text-stone-500">·</span>
              <span className="text-sm font-semibold text-emerald-300 tabular-nums">
                {qp} <span className="font-normal text-stone-500">quest points</span>
                <span className="text-stone-600"> (of {maxQp})</span>
              </span>
              <span className="ml-auto text-xs text-stone-500 tabular-nums">{pct}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-stone-800 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 22 }}
              />
            </div>
          </CardContent>
        </Card>

        {/* controls */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardContent className="pt-4 pb-4 px-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <Search
                  className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500"
                  aria-hidden
                />
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search quests…"
                  aria-label="Search quests by name"
                  className="pl-8 bg-stone-950 border-stone-700 focus-visible:ring-amber-600"
                />
              </div>
              <div
                className="flex overflow-hidden rounded-md border border-stone-700"
                role="group"
                aria-label="Filter by completion status"
              >
                {(["all", "todo", "done"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    aria-pressed={status === s}
                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      status === s
                        ? "bg-amber-600 text-stone-950"
                        : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                    }`}
                  >
                    {s === "all" ? "All" : s === "todo" ? "To do" : "Done"}
                  </button>
                ))}
              </div>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger
                  className="w-[10.5rem] bg-stone-950 border-stone-700 text-stone-200"
                  aria-label="Filter by difficulty"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-stone-900 border-stone-700">
                  <SelectItem value="all">All difficulties</SelectItem>
                  {difficultyKeys.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
                <SelectTrigger
                  className="w-[9.5rem] bg-stone-950 border-stone-700 text-stone-200"
                  aria-label="Sort quests"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-stone-900 border-stone-700">
                  <SelectItem value="az">A → Z</SelectItem>
                  <SelectItem value="difficulty">Difficulty</SelectItem>
                  <SelectItem value="release">Newest release</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-stone-500" aria-live="polite">
                {visible.length} quest{visible.length === 1 ? "" : "s"} shown
                {status !== "all" || difficulty !== "all" || query ? " (filtered)" : ""}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={visible.length === 0}
                  onClick={() => setPendingBulk("check")}
                  className="border-emerald-800/70 text-emerald-300 hover:bg-emerald-950/40 transition-transform active:scale-[0.97] disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  Mark shown done
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={visible.length === 0}
                  onClick={() => setPendingBulk("uncheck")}
                  className="border-stone-700 text-stone-400 hover:text-red-300 hover:bg-stone-900 transition-transform active:scale-[0.97] disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Uncheck shown
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* RuneLite Quest State Exporter import */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardContent className="pt-4 pb-4 px-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber-900/40 bg-amber-950/30">
                <FileJson className="h-4 w-4 text-amber-300" aria-hidden />
              </div>
              <div className="min-w-[14rem] flex-1">
                <p className="text-sm font-medium text-stone-200">Import from RuneLite</p>
                <p className="text-xs text-stone-500">
                  Bulk-set completions from the JSON written by the{" "}
                  <a
                    href="https://runelite.net/plugin-hub/show/quest-state-exporter"
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400/90 underline decoration-dotted hover:text-amber-300"
                  >
                    Quest State Exporter
                  </a>{" "}
                  plugin — no ticking by hand.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 border-amber-800/70 text-amber-200 hover:bg-amber-950/40 transition-transform active:scale-[0.97]"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                Choose JSON file…
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImportFile(f);
                  e.target.value = "";
                }}
              />
            </div>

            <details className="rounded-md border border-stone-800 bg-stone-950/60 px-3 py-2">
              <summary className="cursor-pointer select-none text-xs font-medium text-stone-300 marker:text-stone-600 hover:text-stone-100">
                How to get the file (RuneLite setup)
              </summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-stone-400">
                <li>
                  Open RuneLite and click the{" "}
                  <b className="text-stone-200">Plugin Hub</b> tab in the right-side panel
                  (puzzle-piece icon).
                </li>
                <li>
                  Search for <b className="text-stone-200">Quest State Exporter</b>, install it and
                  leave it enabled. It&apos;s an official Plugin Hub plugin that only reads quest
                  states — nothing else about your account.
                </li>
                <li>
                  Log in to the character you want to import. There is no button to press: the file
                  is written automatically a few seconds after login, whenever quest progress
                  changes, and on a five-minute heartbeat while you&apos;re online.
                </li>
                <li>
                  Find the JSON on your computer — it&apos;s inside the{" "}
                  <code className="rounded bg-stone-900 px-1 py-0.5 text-[10px] text-amber-200">
                    .runelite
                  </code>{" "}
                  folder in your home directory, named after the account:
                  <span className="mt-1 block space-y-0.5 font-mono text-[10px] text-stone-300">
                    <span className="block">
                      Windows: C:\Users\&lt;You&gt;\.runelite\quest-state-exporter\&lt;Account&gt;.json
                    </span>
                    <span className="block">macOS: ~/.runelite/quest-state-exporter/&lt;Account&gt;.json</span>
                    <span className="block">Linux: ~/.runelite/quest-state-exporter/&lt;Account&gt;.json</span>
                  </span>
                </li>
                <li>Pick that file above and apply it below — quests the file says are FINISHED get checked, everything else is left alone (or fully synced with the red button).</li>
              </ol>
            </details>

            {importPreview && (
              <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-[12rem] flex-1 text-sm text-stone-200">
                    <span className="font-semibold text-emerald-300">
                      {importPreview.rsn ?? "Unknown character"}
                    </span>
                    {importPreview.timestampIso &&
                      !Number.isNaN(Date.parse(importPreview.timestampIso)) && (
                        <span className="text-xs text-stone-500">
                          {" "}
                          · exported {new Date(importPreview.timestampIso).toLocaleString()}
                        </span>
                      )}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setImportPreview(null)}
                    className="h-7 px-2 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                    aria-label="Dismiss import preview"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <Badge className="border-emerald-800/60 bg-emerald-950/40 text-emerald-300">
                    {importPreview.finishedKeys.length} finished
                  </Badge>
                  <Badge className="border-amber-800/60 bg-amber-950/40 text-amber-300">
                    {importPreview.inProgressCount} in progress (left as-is)
                  </Badge>
                  <Badge className="border-stone-700 bg-stone-900 text-stone-400">
                    {importPreview.notFinishedKeys.length - importPreview.inProgressCount} not
                    started
                  </Badge>
                  {importPreview.fileQuestPoints !== null && (
                    <Badge className="border-stone-700 bg-stone-900 text-stone-400">
                      {importPreview.fileQuestPoints} QP in file
                    </Badge>
                  )}
                  {importPreview.unmatched.length > 0 && (
                    <Badge className="border-red-900/60 bg-red-950/30 text-red-300">
                      {importPreview.unmatched.length} unknown to this app (ignored)
                    </Badge>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => applyImport("merge")}
                    className="bg-emerald-700 font-semibold text-stone-50 hover:bg-emerald-600 transition-transform active:scale-[0.97]"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Add {importPreview.finishedKeys.length} finished
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPendingSync(true)}
                    className="border-red-900/60 text-red-300 hover:bg-red-950/40 transition-transform active:scale-[0.97]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                    Sync to file…
                  </Button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-stone-500">
                  <b className="text-stone-400">Add</b> only checks quests the file says are
                  finished. <b className="text-stone-400">Sync</b> also unchecks quests the file
                  says aren&apos;t finished — quests the plugin doesn&apos;t track (e.g. brand-new
                  releases) are left untouched.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* quest list */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardContent className="p-0">
            {visible.length === 0 ? (
              <p className="py-12 text-center text-sm text-stone-500">
                No quests match the current filters.
              </p>
            ) : (
              <ul className="divide-y divide-stone-800/80">
                {visible.map((q) => {
                  const done = completed.has(q.key);
                  return (
                    <li
                      key={q.key}
                      className={`flex items-center gap-3 px-4 py-2 transition-colors hover:bg-stone-900/60 ${
                        done ? "bg-emerald-950/10" : ""
                      }`}
                    >
                      <Checkbox
                        checked={done}
                        onCheckedChange={() => toggle(q.key)}
                        aria-label={done ? `Mark ${q.name} not complete` : `Mark ${q.name} complete`}
                        className="border-stone-600 data-[state=checked]:bg-emerald-700 data-[state=checked]:border-emerald-700"
                      />
                      <a
                        href={wikiUrl(q.name)}
                        target="_blank"
                        rel="noreferrer"
                        className={`min-w-0 flex-1 truncate text-sm hover:text-amber-300 hover:underline ${
                          done ? "text-stone-500 line-through" : "text-stone-100"
                        }`}
                      >
                        {q.name}
                      </a>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge className={`text-[9px] px-1.5 border ${DIFF_COLORS[q.difficulty]}`}>
                          {q.difficulty}
                        </Badge>
                        {!q.f2p && (
                          <Badge variant="secondary" className="text-[9px] px-1.5 bg-stone-800 text-stone-400">
                            P2P
                          </Badge>
                        )}
                        <span
                          className="w-10 text-right text-[10px] tabular-nums text-stone-500"
                          title="Quest points awarded for completing this quest"
                        >
                          {questPointsAwarded(q)} QP
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <p className="pb-4 text-[10px] text-stone-600">
          Progress is stored locally in your browser (the same storage the planner reads) — use the
          planner&apos;s <span className="text-stone-500">Backup</span> dialog to export or restore it.
          Miniquests and activities award no quest points, matching the in-game tally.
        </p>

        <p className="pb-4 text-[10px] tabular-nums text-stone-700" title="Deployed build — matches the GHCR image tag">
          {APP_VERSION} · build {APP_BUILD}
        </p>
      </main>

      {/* bulk confirm */}
      <AlertDialog open={!!pendingBulk} onOpenChange={(o) => !o && setPendingBulk(null)}>
        <AlertDialogContent className="max-w-md border-stone-700 bg-stone-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-stone-100">
              {pendingBulk === "check" ? "Mark all shown quests done?" : "Uncheck all shown quests?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-stone-400">
              This affects the {visible.length} quest{visible.length === 1 ? "" : "s"} currently
              visible.{" "}
              {pendingBulk === "uncheck"
                ? "Unchecking removes their completion from your saved progress."
                : "They'll count as finished in every plan and the quest-points estimate."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-stone-700 bg-transparent text-stone-300 hover:bg-stone-800 hover:text-stone-100">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={applyBulk}
              className={
                pendingBulk === "check"
                  ? "bg-emerald-700 font-semibold text-stone-50 hover:bg-emerald-600"
                  : "bg-red-800 font-semibold text-stone-50 hover:bg-red-700"
              }
            >
              {pendingBulk === "check" ? `Mark ${visible.length} done` : `Uncheck ${visible.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* RuneLite import — sync confirm (destructive: unchecks quests) */}
      <AlertDialog open={pendingSync} onOpenChange={(o) => !o && setPendingSync(false)}>
        <AlertDialogContent className="max-w-md border-stone-700 bg-stone-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-stone-100">
              Sync completions to the file?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-stone-400">
              This sets your completions to exactly what the file reports for{" "}
              {importPreview?.rsn ?? "this character"}: {importPreview?.finishedKeys.length ?? 0}{" "}
              quests checked and {importPreview?.notFinishedKeys.length ?? 0} unchecked. Quests the
              plugin doesn&apos;t track are left as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-stone-700 bg-transparent text-stone-300 hover:bg-stone-800 hover:text-stone-100">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => applyImport("sync")}
              className="bg-red-800 font-semibold text-stone-50 hover:bg-red-700"
            >
              Sync {importPreview?.finishedKeys.length ?? 0} done /{" "}
              {importPreview?.notFinishedKeys.length ?? 0} cleared
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
