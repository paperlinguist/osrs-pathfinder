"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SKILL_NAMES,
  XP_PER_HOUR,
  formatXp,
  normalizePlayer,
  type PlayerSkills,
} from "@/lib/quest-data";
import {
  SKILL_INFO,
  nextMilestone,
  pendingQuestXp,
  skillRewards,
  skillUnlocks,
  type SkillRewardRow,
  type SkillUnlockRow,
} from "@/lib/skill-explorer";
import { APP_BUILD, APP_VERSION, REPO_URL } from "@/lib/version";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  ListChecks,
  Swords,
} from "lucide-react";

/* ------------------------------------------------------------------ utils */

function wikiUrl(name: string) {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(name).replace(/%2F/g, "/").replace(/%20/g, "_")}`;
}

function planUrl(key: string) {
  return `/?target=${encodeURIComponent(key)}`;
}

const STATUS_STYLES: Record<SkillRewardRow["status"], { label: string; cls: string }> = {
  ready: { label: "ready", cls: "border-emerald-800/50 bg-emerald-950/40 text-emerald-300" },
  boost: { label: "boost", cls: "border-amber-800/50 bg-amber-950/30 text-amber-300" },
  gated: { label: "gated", cls: "border-red-900/50 bg-red-950/30 text-red-300" },
  completed: { label: "done", cls: "border-stone-700 bg-stone-900 text-stone-500" },
};

export default function SkillsPage() {
  const [player, setPlayer] = useState<PlayerSkills | null>(null);
  const [completed, setCompleted] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<string>("Agility");
  const [showDoneUnlocks, setShowDoneUnlocks] = useState(false);

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

  const level = player ? (player.levels[selected] ?? 1) : null;
  const milestone = useMemo(
    () => (player ? nextMilestone(selected, player) : null),
    [player, selected],
  );
  const rewards = useMemo(
    () => skillRewards(selected, player, completed, { allowBoosts: true, includeQuestXp: true }),
    [selected, player, completed],
  );
  const unlocks = useMemo(
    () => skillUnlocks(selected, player, completed),
    [selected, player, completed],
  );
  const questXpLeft = useMemo(
    () => pendingQuestXp(selected, completed),
    [selected, completed],
  );
  const info = SKILL_INFO[selected];

  const readyCount = rewards.filter((r) => r.status === "ready" || r.status === "boost").length;
  const unlockedNow = unlocks.filter((u) => u.unlocked === true && u.completed !== true);
  const lockedNext = unlocks.filter((u) => u.unlocked === false).slice(0, 8);
  const visibleUnlocks = showDoneUnlocks ? unlocks.filter((u) => u.completed === true) : [];

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(ellipse_at_top,#1c1917_0%,#0c0a09_60%)]">
      {/* header */}
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
            href="/bosses"
            aria-label="Boss gear planner"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2.5 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
          >
            <Swords className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Bosses</span>
          </Link>
          <Link
            href="/completions"
            aria-label="Manage quest completions"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2.5 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Quests</span>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-amber-200">Skill explorer</h1>
            <p className="text-xs text-stone-400">
              Pick a skill — quests that reward it, levels that unlock content, and rough training
              methods.
            </p>
          </div>
        </div>
      </header>

      <main className="w-full max-w-5xl mx-auto px-4 py-6 space-y-4 flex-1">
        {/* skill picker */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a skill">
          {SKILL_NAMES.map((s) => {
            const lv = player ? (player.levels[s] ?? 1) : null;
            const active = s === selected;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSelected(s)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-amber-500 bg-amber-500/15 text-amber-200"
                    : "border-stone-700 bg-stone-950/80 text-stone-300 hover:border-amber-700/70 hover:bg-stone-900 hover:text-amber-200"
                }`}
              >
                {s}
                {lv !== null && lv > 1 && (
                  <span className="tabular-nums text-stone-500">{lv}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* your level + milestone */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardContent className="pt-4 pb-4 px-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {player ? (
              <>
                <span className="text-2xl font-bold text-amber-300 tabular-nums">
                  {level}
                  <span className="text-sm font-medium text-stone-500"> / 99</span>
                </span>
                <span className="text-xs text-stone-400">
                  {player.xp?.[selected] ? formatXp(player.xp[selected]) : "—"} XP
                </span>
                {milestone && (
                  <span className="text-xs text-stone-400">
                    → level {milestone.level}:{" "}
                    <b className="text-stone-200">{formatXp(milestone.xpNeeded)} XP</b>{" "}
                    ≈{milestone.hours ?? "?"} of training
                  </span>
                )}
                {questXpLeft > 0 && (
                  <span className="text-xs text-stone-400">
                    · <b className="text-emerald-300">{formatXp(questXpLeft)} XP</b> still available
                    from unfinished quests
                  </span>
                )}
              </>
            ) : (
              <p className="text-xs text-stone-400">
                No character imported — import on the{" "}
                <Link href="/" className="underline underline-offset-2 hover:text-stone-200">
                  planner
                </Link>{" "}
                to see your level, ready-checks and milestones.
              </p>
            )}
          </CardContent>
        </Card>

        {/* quest XP rewards */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-stone-200">
              Quest XP rewards
              {player && readyCount > 0 && (
                <Badge className="ml-2 border-emerald-800/50 bg-emerald-950/40 text-emerald-300">
                  {readyCount} you could do now
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Every quest that grants {selected} XP, sorted by whether you can do it today.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rewards.length === 0 ? (
              <p className="text-xs text-stone-400">
                No quests award {selected} XP — this one is pure training.
              </p>
            ) : (
              <div className="divide-y divide-stone-800/70 rounded-md border border-stone-800 bg-stone-950/40">
                {rewards.map((r) => (
                  <RewardRow key={r.key} row={r} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* level unlocks */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-stone-200">
              What {selected} levels unlock
            </CardTitle>
            <CardDescription className="text-xs">
              Quests and achievement-diary tiers that require {selected}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {player === null ? (
              <p className="text-xs text-stone-500">
                Import a character to split these by your current level.
              </p>
            ) : (
              <>
                {unlockedNow.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
                      Unlocked at your level ({level}) — not done yet
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {unlockedNow.slice(0, 12).map((u) => (
                        <UnlockChip key={u.key} u={u} />
                      ))}
                      {unlockedNow.length > 12 && (
                        <span className="text-[11px] text-stone-500 self-center">
                          +{unlockedNow.length - 12} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {lockedNext.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                      Coming up
                    </p>
                    <div className="space-y-1">
                      {lockedNext.map((u) => (
                        <div key={u.key} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="text-stone-500 tabular-nums">{u.required}</span>
                          <span className="text-stone-200">{u.name}</span>
                          <span className="text-stone-500">
                            (you: {level} → {u.required})
                          </span>
                          <Link
                            href={planUrl(u.key)}
                            className="text-amber-400/80 underline underline-offset-2 hover:text-amber-300"
                          >
                            plan it →
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {unlocks.some((u) => u.completed === true) && (
                  <button
                    type="button"
                    onClick={() => setShowDoneUnlocks((v) => !v)}
                    className="text-[11px] text-stone-500 underline underline-offset-2 hover:text-stone-300"
                  >
                    {showDoneUnlocks ? "hide" : "show"} completed (
                    {unlocks.filter((u) => u.completed === true).length})
                  </button>
                )}
                {showDoneUnlocks && (
                  <div className="flex flex-wrap gap-1.5">
                    {visibleUnlocks.map((u) => (
                      <UnlockChip key={u.key} u={u} done />
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* training methods */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-stone-200">
              <BookOpen className="h-4 w-4 text-amber-300" aria-hidden />
              Training methods
              <a
                href={wikiUrl(info?.guide ?? selected)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-[11px] font-normal text-stone-500 hover:text-amber-300"
              >
                wiki guide <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </CardTitle>
            <CardDescription className="text-xs">
              Rough orientation only — rates swing with method variants, boosts and attention.
              Treat the wiki guide as authoritative.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-stone-800/70 rounded-md border border-stone-800 bg-stone-950/40">
              {(info?.methods ?? []).map((m) => {
                const relevant = level === null || level >= m.level;
                return (
                  <div
                    key={m.name}
                    className={`px-3 py-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 ${relevant ? "" : "opacity-50"}`}
                  >
                    <span className="w-14 shrink-0 text-[11px] tabular-nums text-stone-500">
                      {m.level}+
                    </span>
                    <span className="text-sm text-stone-200">{m.name}</span>
                    <span className="text-xs text-stone-400">
                      {m.xpHour !== null ? `≈${formatXp(m.xpHour)} xp/h` : "rates vary"}
                    </span>
                    {m.note && <span className="text-xs text-stone-500">— {m.note}</span>}
                    {!relevant && (
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-stone-600">
                        locked
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-stone-600">
              App-wide estimate used for time-to-level maths:{" "}
              ≈{formatXp(XP_PER_HOUR[selected] ?? 0)} xp/h for {selected}.
            </p>
          </CardContent>
        </Card>
      </main>

      <footer className="border-t border-stone-900 mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-3 text-[10px] text-stone-600">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-stone-400"
          >
            source
          </a>
          {" · "}
          <span className="tabular-nums" title="Deployed build — matches the GHCR image tag">
            {APP_VERSION} · build {APP_BUILD}
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------- sub views */

function RewardRow({ row }: { row: SkillRewardRow }) {
  const st = STATUS_STYLES[row.status];
  return (
    <div className="px-3 py-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="w-16 shrink-0 text-xs tabular-nums text-amber-300">
        +{formatXp(row.xp)}
      </span>
      <Link
        href={planUrl(row.key)}
        title={`Track ${row.name} in the planner`}
        className="text-sm text-stone-200 hover:text-amber-300 hover:underline"
      >
        {row.name}
      </Link>
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {row.gates.map((g) => (
          <Badge key={g} className="border-stone-700 bg-stone-900 text-stone-400">
            {g}
          </Badge>
        ))}
        <Badge className={st.cls}>{st.label}</Badge>
      </span>
    </div>
  );
}

function UnlockChip({ u, done }: { u: SkillUnlockRow; done?: boolean }) {
  return (
    <Link
      href={planUrl(u.key)}
      title={`Track ${u.name} in the planner`}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
        done
          ? "border-stone-700 bg-stone-900 text-stone-500"
          : "border-emerald-800/50 bg-emerald-950/30 text-emerald-300 hover:border-emerald-600 hover:text-emerald-200"
      }`}
    >
      {done && <CheckCircle2 className="h-3 w-3 mr-0.5" aria-hidden />}
      {u.name}
      {u.isDiary && <span className="text-stone-500">· diary</span>}
    </Link>
  );
}
