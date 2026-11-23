"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DIARIES,
  DIFF_COLORS,
  QUEST_BY_KEY,
  normalizePlayer,
  type PlayerSkills,
} from "@/lib/quest-data";
import { diaryProgress, type DiaryProgress } from "@/lib/diary-progress";
import { APP_BUILD, APP_VERSION, REPO_URL } from "@/lib/version";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  ListChecks,
  Swords,
  Trophy,
} from "lucide-react";

function planUrl(key: string) {
  return `/?target=${encodeURIComponent(key)}`;
}

function questName(key: string) {
  return QUEST_BY_KEY[key]?.name ?? key;
}

const STATUS_STYLES: Record<DiaryProgress["status"], { label: string; cls: string }> = {
  done: { label: "done", cls: "border-emerald-800/50 bg-emerald-950/40 text-emerald-300" },
  ready: { label: "ready to claim", cls: "border-teal-800/50 bg-teal-950/40 text-teal-300" },
  incomplete: { label: "incomplete", cls: "border-amber-800/50 bg-amber-950/30 text-amber-300" },
  unknown: { label: "import to check", cls: "border-stone-700 bg-stone-900 text-stone-400" },
};

export default function DiariesPage() {
  const [player, setPlayer] = useState<PlayerSkills | null>(null);
  const [completed, setCompleted] = useState<Set<string> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>(DIARIES[0]?.key ?? "");
  const [filter, setFilter] = useState<"all" | "incomplete" | "done">("all");
  const [sort, setSort] = useState<"area" | "closest">("area");

  useEffect(() => {
    try {
      const p = localStorage.getItem("osrs-qp-player");
      if (p) setPlayer(normalizePlayer(JSON.parse(p)));
      const c = localStorage.getItem("osrs-qp-completed");
      if (c !== null) setCompleted(new Set(JSON.parse(c) as string[]));
    } catch {
      /* corrupt saves — start fresh */
    }
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "osrs-qp-completed" && e.newValue !== null) {
        try {
          setCompleted(new Set(JSON.parse(e.newValue) as string[]));
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const progress = useMemo(
    () => DIARIES.map((d) => diaryProgress(d, player, completed)),
    [player, completed],
  );

  const shown = useMemo(() => {
    let list = progress.filter((p) => {
      if (filter === "incomplete") return p.status !== "done";
      if (filter === "done") return p.status === "done";
      return true;
    });
    if (sort === "closest") {
      list = [...list].sort(
        (a, b) => a.remainingCount - b.remainingCount || a.diary.area.localeCompare(b.diary.area),
      );
    }
    return list;
  }, [progress, filter, sort]);

  const selected = progress.find((p) => p.diary.key === selectedKey);
  const hasData = player !== null || completed !== null;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1c1917_0%,#0c0a09_60%)]">
      <header className="border-b border-amber-900/30 bg-stone-950/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/"
            aria-label="Back to the planner"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2.5 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Planner</span>
          </Link>
          <Link
            href="/completions"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2.5 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Quests</span>
          </Link>
          <Link
            href="/skills"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2.5 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Skills</span>
          </Link>
          <Link
            href="/bosses"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2.5 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
          >
            <Swords className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Bosses</span>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-amber-200">Diary explorer</h1>
            <p className="text-xs text-stone-400">
              Every Achievement Diary tier, ranked by how close you are — track any of them from
              the planner.
            </p>
          </div>
        </div>
      </header>

      <main className="w-full max-w-5xl mx-auto px-4 py-6 space-y-4">
        {!hasData && (
          <Card className="border-amber-900/40 bg-amber-950/20">
            <CardContent className="pt-4 pb-4 px-4 flex items-start gap-3">
              <CircleHelp className="h-4 w-4 mt-0.5 text-amber-300 shrink-0" aria-hidden />
              <p className="text-xs leading-relaxed text-stone-300">
                No character imported — you&apos;re seeing the diary guide without personal
                verdicts. Import <b>character.json</b> on the{" "}
                <Link href="/" className="underline underline-offset-2 hover:text-stone-100">planner</Link>{" "}
                and mark quests complete on the{" "}
                <Link href="/completions" className="underline underline-offset-2 hover:text-stone-100">Quests page</Link>{" "}
                to light up each tier&apos;s gaps.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter by status"
            className="inline-flex rounded-md border border-stone-700 bg-stone-950/80 p-0.5"
          >
            {(
              [
                ["all", "All"],
                ["incomplete", "Incomplete"],
                ["done", "Done"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFilter(val)}
                aria-pressed={filter === val}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  filter === val ? "bg-amber-500/20 text-amber-200" : "text-stone-400 hover:text-stone-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label="Sort"
            className="inline-flex rounded-md border border-stone-700 bg-stone-950/80 p-0.5"
          >
            {(
              [
                ["area", "By area"],
                ["closest", "Closest first"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setSort(val)}
                aria-pressed={sort === val}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  sort === val ? "bg-amber-500/20 text-amber-200" : "text-stone-400 hover:text-stone-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-stone-500 tabular-nums">
            {shown.length} of {DIARIES.length} tiers
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => {
            const active = p.diary.key === selectedKey;
            const left =
              p.skillGaps.length > 0 || p.questGaps.length > 0
                ? `${p.skillGaps.length} skill${p.skillGaps.length === 1 ? "" : "s"} · ${p.questGaps.length} quest${p.questGaps.length === 1 ? "" : "s"} left`
                : p.status === "done"
                  ? "complete"
                  : "all requirements met";
            return (
              <button
                key={p.diary.key}
                onClick={() => setSelectedKey(p.diary.key)}
                className={`text-left rounded-lg border p-3 space-y-2 transition-colors ${
                  active
                    ? "border-amber-700/70 bg-stone-900"
                    : "border-stone-800 bg-stone-900/40 hover:border-stone-700 hover:bg-stone-900/70"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-stone-100">{p.diary.area}</span>
                  <Badge className={DIFF_COLORS[p.diary.tier] ?? DIFF_COLORS.Unknown}>
                    {p.diary.tier}
                  </Badge>
                  <span
                    className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_STYLES[p.status].cls}`}
                  >
                    {p.status === "done" && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                    {STATUS_STYLES[p.status].label}
                  </span>
                </div>
                <p className="text-[11px] text-stone-500">
                  {left}
                  {p.remainingCount > 0 && <span className="text-stone-600"> · remaining</span>}
                </p>
              </button>
            );
          })}
        </div>

        {selected && (
          <DiaryDetail p={selected} completed={completed} />
        )}

        <footer className="pt-4 pb-2 text-center text-[11px] text-stone-600 space-y-1">
          <p>
            Diary tiers from the OSRS Wiki — skill and quest requirements only; the task-by-task
            checklist lives on each diary&apos;s wiki page. Track a tier from the planner to pull
            in its quest chain and training gates.
          </p>
          <p>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-stone-400">
              source
            </a>
            {" · "}
            {APP_VERSION} · build {APP_BUILD}
          </p>
        </footer>
      </main>
    </div>
  );
}

function DiaryDetail({ p, completed }: { p: DiaryProgress; completed: Set<string> | null }) {
  const d = p.diary;
  return (
    <Card className="border-stone-800 bg-stone-900/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-stone-200">
          <Trophy className="h-4 w-4 text-amber-300" aria-hidden />
          {d.name}
          <a
            href={`https://oldschool.runescape.wiki/w/${encodeURIComponent(d.wikiName).replace(/%20/g, "_")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-[11px] font-normal text-stone-500 hover:text-amber-300"
          >
            wiki <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          <Link
            href={planUrl(d.key)}
            className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-amber-400/80 underline underline-offset-2 hover:text-amber-300"
          >
            track in planner →
          </Link>
        </CardTitle>
        <CardDescription className="text-xs">
          {STATUS_STYLES[p.status].label} · {d.area} · {d.tier}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(p.skillGaps.length > 0 || p.metSkills.length > 0) && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Skills</p>
            <div className="flex flex-wrap gap-1.5">
              {[...p.metSkills, ...p.skillGaps].map((g) => (
                <Badge
                  key={g.skill}
                  className={
                    g.met
                      ? "border-emerald-800/50 bg-emerald-950/40 text-emerald-300"
                      : g.boostable
                        ? "border-amber-800/50 bg-amber-950/30 text-amber-300"
                        : "border-stone-700 bg-stone-900 text-stone-400"
                  }
                  title={g.met ? undefined : `${g.skill} ${g.current ?? "?"} → ${g.required}`}
                >
                  {g.skill} {g.current ?? "?"}/{g.required}
                  {g.met ? " ✓" : g.boostable ? " · boost" : ""}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {d.quests.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Quests</p>
            <div className="flex flex-wrap gap-1.5">
              {d.quests.map((key) => {
                const done = completed?.has(key) ?? false;
                return done ? (
                  <Badge key={key} className="border-emerald-800/50 bg-emerald-950/40 text-emerald-300">
                    <CheckCircle2 className="h-3 w-3 mr-0.5" aria-hidden />
                    {questName(key)}
                  </Badge>
                ) : (
                  <Link key={key} href={planUrl(key)}>
                    <Badge className="border-amber-800/50 bg-amber-950/30 text-amber-300 underline decoration-dotted underline-offset-2">
                      {questName(key)}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {d.notes && <p className="text-xs leading-relaxed text-stone-500">{d.notes}</p>}
      </CardContent>
    </Card>
  );
}
