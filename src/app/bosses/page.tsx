"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMPTY_OWNED,
  buildOwnedIndex,
  mergeOwned,
  normalizeOwned,
  readCharacterExportFiles,
  type OwnedItems,
} from "@/lib/character-export";
import { QUESTS, normalizePlayer, type PlayerSkills } from "@/lib/quest-data";
import {
  BOSSES,
  SLOT_KEYS,
  SLOT_LABELS,
  TIER_COLORS,
  formatPrice,
  questName,
  statChips,
  type Boss,
} from "@/lib/boss-data";
import {
  evaluateBoss,
  type BossVerdict,
  type ItemCheck,
  type PresetCheck,
} from "@/lib/boss-readiness";
import { suggestUpgrades, type UpgradeReport, type UpgradeSuggestion } from "@/lib/upgrade-advisor";
import { resolveChain } from "@/lib/resolver";
import { useToast } from "@/hooks/use-toast";
import { APP_BUILD, APP_VERSION } from "@/lib/version";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Coins,
  ExternalLink,
  ListChecks,
  PackageOpen,
  Search,
  Shirt,
  Swords,
  Upload,
  X,
} from "lucide-react";

/* ------------------------------------------------------------------ utils */

function wikiUrl(name: string) {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(name).replace(/%2F/g, "/").replace(/%20/g, "_")}`;
}

/** planner deep-link for tracking a quest */
function planUrl(key: string) {
  return `/?target=${encodeURIComponent(key)}`;
}

/* quest names for prose linkification — canonical display names (registryName
   where the dataset name is non-canonical), longest first so e.g. "Desert
   Treasure II" wins over "Desert Treasure" */
const QUEST_MENTIONS: { name: string; key: string }[] = (() => {
  const seen = new Set<string>();
  const out: { name: string; key: string }[] = [];
  for (const q of QUESTS) {
    for (const n of [q.registryName ?? q.name, q.name]) {
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push({ name: n, key: q.key });
    }
  }
  return out.sort((a, b) => b.name.length - a.name.length);
})();

/** render free text with every mentioned quest as a "plan it" deep-link —
 *  quests already on the plan turn emerald with a ✓ */
function linkifyQuests(text: string, planned: Set<string>): React.ReactNode {
  const matches: { start: number; end: number; key: string }[] = [];
  for (const q of QUEST_MENTIONS) {
    let idx = text.indexOf(q.name);
    while (idx !== -1) {
      if (!matches.some((m) => idx < m.end && m.start < idx + q.name.length)) {
        matches.push({ start: idx, end: idx + q.name.length, key: q.key });
      }
      idx = text.indexOf(q.name, idx + 1);
    }
  }
  if (matches.length === 0) return text;
  matches.sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) out.push(text.slice(pos, m.start));
    const isPlanned = planned.has(m.key);
    out.push(
      <Link
        key={m.start}
        href={isPlanned ? "/" : planUrl(m.key)}
        title={isPlanned ? "Already on your plan — view it" : "Track this quest in the planner"}
        className={
          isPlanned
            ? "font-medium text-emerald-400 underline decoration-dotted underline-offset-2 hover:text-emerald-300"
            : "font-medium text-amber-300/90 underline decoration-dotted underline-offset-2 hover:text-amber-200"
        }
      >
        {text.slice(m.start, m.end)}
        {isPlanned ? " ✓" : ""}
      </Link>,
    );
    pos = m.end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

const VERDICT_STYLES: Record<BossVerdict["status"], { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-emerald-900/60 text-emerald-300 border-emerald-700/50" },
  gated: { label: "Not yet", cls: "bg-amber-900/50 text-amber-300 border-amber-700/50" },
  unknown: { label: "Import to check", cls: "bg-stone-800 text-stone-300 border-stone-600" },
};

export default function BossesPage() {
  const { toast } = useToast();

  /* ------------------------------------------------------------- state */
  const [player, setPlayer] = useState<PlayerSkills | null>(null);
  const [completed, setCompleted] = useState<Set<string> | null>(null);
  const [owned, setOwned] = useState<OwnedItems>(EMPTY_OWNED);
  const [targets, setTargets] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(BOSSES[0]?.key ?? "");
  /** advisor open state lives here so the header shortcut can open it */
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [readyFilter, setReadyFilter] = useState<"all" | "ready" | "gated">("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  /** set when a card click should scroll to the just-selected boss detail */
  const pendingDetailScroll = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------- localStorage hydration */
  useEffect(() => {
    try {
      const p = localStorage.getItem("osrs-qp-player");
      if (p) setPlayer(normalizePlayer(JSON.parse(p)));
      const c = localStorage.getItem("osrs-qp-completed");
      // null key = never saved → we can't distinguish "no quests done" from
      // "no data"; treat a present key as data, absent as null
      if (c !== null) setCompleted(new Set(JSON.parse(c) as string[]));
      const o = localStorage.getItem("osrs-qp-owned");
      if (o) setOwned(normalizeOwned(JSON.parse(o)));
      const t = localStorage.getItem("osrs-qp-targets");
      if (t) {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) setTargets(arr.filter((k): k is string => typeof k === "string"));
      }
      const a = localStorage.getItem("osrs-qp-added");
      if (a) {
        const arr = JSON.parse(a);
        if (Array.isArray(arr)) setAdded(arr.filter((k): k is string => typeof k === "string"));
      }
    } catch {
      /* corrupt saves — start fresh */
    }
  }, []);

  // live-sync with the planner / completions pages (same keys, storage events)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "osrs-qp-completed" && e.newValue !== null) {
        try {
          setCompleted(new Set(JSON.parse(e.newValue) as string[]));
        } catch { /* ignore */ }
      }
      // character switching / backup restore swaps imported items too
      if (e.key === "osrs-qp-owned") {
        try {
          setOwned(e.newValue ? normalizeOwned(JSON.parse(e.newValue)) : EMPTY_OWNED);
        } catch { /* ignore */ }
      }
      // plan tracking changes on the planner update "planned" badges live
      if (e.key === "osrs-qp-targets" && e.newValue !== null) {
        try {
          const arr = JSON.parse(e.newValue);
          setTargets(Array.isArray(arr) ? arr.filter((k): k is string => typeof k === "string") : []);
        } catch { /* ignore */ }
      }
      if (e.key === "osrs-qp-added" && e.newValue !== null) {
        try {
          const arr = JSON.parse(e.newValue);
          setAdded(Array.isArray(arr) ? arr.filter((k): k is string => typeof k === "string") : []);
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* --------------------------------------------------------- import flow */

  const onImportFiles = useCallback(
    async (files: File[]) => {
      const readout = await readCharacterExportFiles(files);
      if (!readout.player && !readout.questState && readout.containers.length === 0) {
        toast({
          title: "Nothing imported",
          description:
            "Pick files from Character Export's folder — character.json, quests.json, bank.json, equipment.json, inventory.json.",
          variant: "destructive",
        });
        return;
      }
      const parts: string[] = [];
      if (readout.player) {
        setPlayer(readout.player);
        localStorage.setItem("osrs-qp-player", JSON.stringify(readout.player));
        parts.push("skills imported");
      }
      if (readout.questState) {
        const qs = readout.questState;
        // merge-only on this page — full Add/Sync control lives on the Quests page
        setCompleted((prev) => {
          const next = new Set([...(prev ?? []), ...qs.finishedKeys]);
          localStorage.setItem("osrs-qp-completed", JSON.stringify([...next]));
          return next;
        });
        parts.push(`${qs.finishedKeys.length} quests finished (quest gates unlocked)`);
      }
      if (readout.containers.length > 0) {
        setOwned((prev) => {
          const next = mergeOwned(prev, readout.containers);
          localStorage.setItem("osrs-qp-owned", JSON.stringify(next));
          return next;
        });
        for (const c of readout.containers) {
          parts.push(`${c.kind}: ${c.items.length} items`);
        }
      }
      if (readout.unrecognized.length > 0) {
        parts.push(`${readout.unrecognized.length} file(s) not recognised`);
      }
      toast({
        title: "Character Export loaded",
        description: parts.join(" · ") + " — parsed in your browser, nothing uploaded.",
      });
    },
    [toast],
  );

  const clearOwned = useCallback(() => {
    setOwned(EMPTY_OWNED);
    localStorage.removeItem("osrs-qp-owned");
    toast({ title: "Imported items cleared" });
  }, [toast]);

  /* ------------------------------------------------------------ rendering */

  const ownedIndex = useMemo(
    () => (owned.updatedAt ? buildOwnedIndex(owned) : null),
    [owned],
  );

  const verdicts = useMemo(() => {
    const map = new Map<string, BossVerdict>();
    for (const b of BOSSES) {
      map.set(
        b.key,
        evaluateBoss(b, { player, completed, ownedIndex, coins: owned.coins }),
      );
    }
    return map;
  }, [player, completed, ownedIndex, owned.coins]);

  const advisor = useMemo(
    () => (ownedIndex ? suggestUpgrades({ player, completed, ownedIndex, coins: owned.coins }) : null),
    [player, completed, ownedIndex, owned.coins],
  );

  const advisorHasContent =
    advisor !== null &&
    (advisor.buyNow.length > 0 ||
      advisor.saveUp.length > 0 ||
      advisor.earn.length > 0 ||
      advisor.locked.length > 0);

  /** boss list filtered by search, readiness and tier */
  const filteredBosses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return BOSSES.filter((b) => {
      if (q && !b.name.toLowerCase().includes(q) && !b.tagline.toLowerCase().includes(q)) {
        return false;
      }
      const status = verdicts.get(b.key)?.status ?? "unknown";
      if (readyFilter === "ready" && status !== "ready") return false;
      if (readyFilter === "gated" && status !== "gated") return false;
      if (tierFilter !== "all" && b.tier !== tierFilter) return false;
      return true;
    });
  }, [query, readyFilter, tierFilter, verdicts]);

  // reset to the first page whenever the filters change
  useEffect(() => {
    setPage(1);
  }, [query, readyFilter, tierFilter]);

  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(filteredBosses.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageBosses = filteredBosses.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /** header shortcut: expand the advisor and bring it into view */
  const jumpToAdvisor = useCallback(() => {
    setAdvisorOpen(true);
    requestAnimationFrame(() => {
      document
        .getElementById("upgrade-advisor")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  /** select a boss card and scroll its detail into view once it's mounted */
  const selectBoss = useCallback((key: string) => {
    pendingDetailScroll.current = true;
    setSelectedKey(key);
  }, []);

  useEffect(() => {
    if (!pendingDetailScroll.current) return;
    pendingDetailScroll.current = false;
    document
      .getElementById("boss-detail")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedKey]);

  /** every quest already on the resolved plan (tracked target OR prereq step) —
   *  same resolver the planner runs, over the same saved targets/extras */
  const plannedKeys = useMemo(() => {
    const set = new Set<string>();
    if (targets.length === 0) return set;
    try {
      const r = resolveChain(
        targets,
        player ?? { levels: {}, xp: {}, source: "manual" },
        completed ?? new Set<string>(),
        { allowBoosts: true, includeQuestXp: true },
        added,
      );
      if (r) {
        for (const s of r.steps) set.add(s.quest.key);
        for (const t of r.targets) set.add(t.quest.key);
      }
    } catch {
      /* unresolvable targets — treat as nothing planned */
    }
    return set;
  }, [targets, added, player, completed]);

  const selected: Boss | undefined = BOSSES.find((b) => b.key === selectedKey);
  const selectedVerdict = selected ? verdicts.get(selected.key) : undefined;

  const hasAnyData = player !== null || completed !== null;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1c1917_0%,#0c0a09_60%)]">
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
            href="/completions"
            aria-label="Manage quest completions"
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2.5 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] shrink-0"
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Quests</span>
          </Link>
          {advisorHasContent && (
            <button
              type="button"
              onClick={jumpToAdvisor}
              title="What should I buy next? — jump to the upgrade advisor"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-800/70 bg-amber-950/30 px-2.5 py-1.5 text-sm text-amber-200 hover:bg-amber-950/50 transition-transform active:scale-[0.97] shrink-0"
            >
              <Banknote className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Upgrades</span>
              {advisor!.buyNow.length > 0 && (
                <span className="rounded-full bg-emerald-900/60 px-1.5 text-[10px] font-semibold tabular-nums text-emerald-300">
                  {advisor!.buyNow.length}
                </span>
              )}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-amber-200">Boss gear planner</h1>
            <p className="text-xs text-stone-400">
              Am I ready — and what should I wear? Readiness verdicts and budget-tier loadouts
              against your imported character.
            </p>
          </div>
        </div>
      </header>

      <main className="w-full max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* character/bank import */}
        <Card className="border-stone-800 bg-stone-900/60">
          <CardContent className="pt-4 pb-4 px-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber-900/40 bg-amber-950/30">
                <Shirt className="h-4 w-4 text-amber-300" aria-hidden />
              </div>
              <div className="min-w-[14rem] flex-1">
                <p className="text-sm font-medium text-stone-200">Import from Character Export</p>
                <p className="text-xs text-stone-500">
                  character.json (skills), quests.json (quest gates), bank.json, equipment.json and
                  inventory.json — the more you feed it, the smarter the verdicts. Parsed in your
                  browser, never uploaded.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 border-amber-800/70 text-amber-200 hover:bg-amber-950/40 transition-transform active:scale-[0.97]"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />
                Choose files…
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                multiple
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void onImportFiles(files);
                  e.target.value = "";
                }}
              />
            </div>

            {(player || owned.updatedAt) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {player && (
                  <Badge className="border-emerald-800/60 bg-emerald-950/40 text-emerald-300">
                    {player.username ?? "Character"} · combat {player.combatLevel ?? "—"}
                  </Badge>
                )}
                {owned.updatedAt && (
                  <>
                    <Badge className="border-stone-700 bg-stone-900 text-stone-300">
                      <PackageOpen className="h-3 w-3 mr-1" aria-hidden />
                      bank {owned.bank.length} · worn {owned.equipment.length} · inv{" "}
                      {owned.inventory.length}
                    </Badge>
                    {owned.coins !== null && (
                      <Badge className="border-amber-800/60 bg-amber-950/40 text-amber-300">
                        <Coins className="h-3 w-3 mr-1" aria-hidden />
                        {owned.coins.toLocaleString("en-US")} gp
                      </Badge>
                    )}
                    <button
                      onClick={clearOwned}
                      className="text-stone-500 underline underline-offset-2 hover:text-red-300"
                    >
                      clear items
                    </button>
                  </>
                )}
              </div>
            )}

            <details className="rounded-md border border-stone-800 bg-stone-950/60 px-3 py-2">
              <summary className="cursor-pointer select-none text-xs font-medium text-stone-300 marker:text-stone-600 hover:text-stone-100">
                Where are the files?
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-stone-400">
                From the{" "}
                <a
                  href="https://runelite.net/plugin-hub/show/character-export"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400/90 underline decoration-dotted hover:text-amber-300"
                >
                  Character Export
                </a>{" "}
                RuneLite plugin — it writes them automatically while you play:
              </p>
              <span className="mt-1 block space-y-0.5 font-mono text-[10px] text-stone-300">
                <span className="block">
                  Windows: C:\Users\&lt;You&gt;\.runelite\character-exporter\&lt;Account&gt;\
                </span>
                <span className="block">macOS / Linux: ~/.runelite/character-exporter/&lt;Account&gt;/</span>
              </span>
              <p className="mt-2 text-xs text-stone-500">
                Open your bank once in-game so bank.json is fresh. quests.json works here too —
                for full Add/Sync control over quest completions use the{" "}
                <Link href="/completions" className="underline underline-offset-2 hover:text-stone-300">Quests page</Link>.
              </p>
            </details>
          </CardContent>
        </Card>

        {!hasAnyData && (
          <Card className="border-amber-900/40 bg-amber-950/20">
            <CardContent className="pt-4 pb-4 px-4 flex items-start gap-3">
              <CircleHelp className="h-4 w-4 mt-0.5 text-amber-300 shrink-0" aria-hidden />
              <p className="text-xs leading-relaxed text-stone-300">
                No character imported yet — you&apos;re seeing the guide without personal verdicts.
                Import <b>character.json</b> above (or a username on the{" "}
                <Link href="/" className="underline underline-offset-2 hover:text-stone-100">planner</Link>)
                to light up readiness checks, gear gates and buy lists.
              </p>
            </CardContent>
          </Card>
        )}

        {/* upgrade advisor lives BELOW the loadouts — collapsed by default so
            the boss flow comes first; the summary line keeps it discoverable */}

        {/* boss cards */}
        <div id="boss-list" className="scroll-mt-24 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bosses…"
              aria-label="Search bosses"
              className="bg-stone-950 border-stone-700 pl-8 pr-8 focus-visible:ring-amber-600"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
          <div
            role="group"
            aria-label="Filter by readiness"
            className="inline-flex rounded-md border border-stone-700 bg-stone-950/80 p-0.5"
          >
            {(
              [
                ["all", "All"],
                ["ready", "Ready"],
                ["gated", "Not yet"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setReadyFilter(val)}
                aria-pressed={readyFilter === val}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  readyFilter === val
                    ? "bg-amber-500/20 text-amber-200"
                    : "text-stone-400 hover:text-stone-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-36 h-8 border-stone-700 bg-stone-950 text-xs">
              <SelectValue placeholder="All tiers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              {Object.keys(TIER_COLORS)
                .filter((t) => t !== "Unknown")
                .map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-stone-500 tabular-nums">
            {filteredBosses.length === 0
              ? `0 of ${BOSSES.length}`
              : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filteredBosses.length)} of ${filteredBosses.length}`}
          </span>
          {(query.trim() || readyFilter !== "all" || tierFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setReadyFilter("all");
                setTierFilter("all");
              }}
              className="text-[11px] text-amber-400/80 underline underline-offset-2 hover:text-amber-300"
            >
              Reset
            </button>
          )}
        </div>

        {filteredBosses.length === 0 ? (
          <p className="rounded-lg border border-stone-800 bg-stone-900/40 px-3 py-6 text-center text-xs text-stone-500">
            No bosses match{query.trim() ? ` “${query.trim()}”` : " these filters"}
            {!hasAnyData && readyFilter !== "all" ? " — import a character to use the ready filter" : ""}.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pageBosses.map((b) => {
              const v = verdicts.get(b.key)!;
              const active = b.key === selectedKey;
              return (
              <button
                key={b.key}
                onClick={() => selectBoss(b.key)}
                className={`text-left rounded-lg border p-3 space-y-2 transition-colors ${
                  active
                    ? "border-amber-700/70 bg-stone-900"
                    : "border-stone-800 bg-stone-900/40 hover:border-stone-700 hover:bg-stone-900/70"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-stone-100">{b.name}</span>
                  <Badge className={TIER_COLORS[b.tier] ?? TIER_COLORS.Unknown}>{b.tier}</Badge>
                  {!b.members && (
                    <Badge className="border-sky-800/50 bg-sky-950/40 text-sky-300">F2P</Badge>
                  )}
                  <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${VERDICT_STYLES[v.status].cls}`}>
                    {v.status === "ready" && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                    {v.status === "gated" && <AlertTriangle className="h-3 w-3" aria-hidden />}
                    {VERDICT_STYLES[v.status].label}
                  </span>
                </div>
                <p className="text-xs text-stone-400 line-clamp-2">{b.tagline}</p>
                <p className="text-[11px] text-stone-500">
                  {b.duration} · {b.styles.join(" / ")}
                </p>
              </button>
            );
          })}
          </div>
        )}

        {/* pagination — only when the filtered list overflows a page */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={safePage <= 1}
              onClick={() => {
                setPage(safePage - 1);
                pendingDetailScroll.current = false;
                document
                  .getElementById("boss-list")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="border-stone-700 text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] disabled:opacity-40"
            >
              ← Prev
            </Button>
            <span className="text-xs text-stone-400 tabular-nums">
              page {safePage} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages}
              onClick={() => {
                setPage(safePage + 1);
                pendingDetailScroll.current = false;
                document
                  .getElementById("boss-list")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="border-stone-700 text-stone-300 hover:bg-stone-800 transition-transform active:scale-[0.97] disabled:opacity-40"
            >
              Next →
            </Button>
          </div>
        )}

        {/* selected boss detail */}
        {selected && selectedVerdict && (
          <div id="boss-detail" className="scroll-mt-24">
            <BossDetail
              key={selected.key}
              boss={selected}
              verdict={selectedVerdict}
              coins={owned.coins}
              planned={plannedKeys}
            />
          </div>
        )}

        {/* upgrade advisor — end-of-page summary: what to buy next across all bosses */}
        {advisor && (
          <AdvisorCard
            advisor={advisor}
            coins={owned.coins}
            planned={plannedKeys}
            open={advisorOpen}
            onToggle={() => setAdvisorOpen((o) => !o)}
          />
        )}

        <footer className="pt-4 pb-2 text-center text-[11px] text-stone-600 space-y-1">
          <p>
            Presets curated from the OSRS Wiki strategy pages — starting points, not gospel.
            Item stats &amp; equip requirements from{" "}
            <a href="https://github.com/wvanderp/osrs-db" target="_blank" rel="noreferrer" className="underline hover:text-stone-400">
              osrs-db
            </a>{" "}
            (wiki-verified overrides per item), GE prices a build-time snapshot. For exact DPS math
            use the{" "}
            <a
              href="https://oldschool.runescape.wiki/w/Calculator/Combat/DPS"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-stone-400"
            >
              wiki DPS calculator
            </a>
            .
          </p>
          <p>
            v{APP_VERSION} · {APP_BUILD}
          </p>
        </footer>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------ boss detail */

/* --------------------------------------------------------- advisor section */

function AdvisorCard({
  advisor,
  coins,
  planned,
  open,
  onToggle,
}: {
  advisor: UpgradeReport;
  coins: number | null;
  planned: Set<string>;
  open: boolean;
  onToggle: () => void;
}) {
  const empty =
    advisor.buyNow.length === 0 &&
    advisor.saveUp.length === 0 &&
    advisor.earn.length === 0 &&
    advisor.locked.length === 0;

  return (
    <Card id="upgrade-advisor" className="scroll-mt-24 border-stone-800 bg-stone-900/60">
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left"
        >
          <Banknote className="h-4 w-4 text-amber-300 shrink-0" aria-hidden />
          <CardTitle className="flex-1 min-w-0 text-base text-stone-200">
            Upgrade advisor
            <span className="ml-2 text-xs font-normal text-stone-400">
              {empty ? (
                <>nothing to buy — every preset item is owned or a downgrade</>
              ) : (
                <>
                  <b className="text-emerald-300">{advisor.buyNow.length} buy now</b>
                  {advisor.buyNowTotal > 0 && (
                    <> · {formatPrice(advisor.buyNowTotal)}</>
                  )}
                  {advisor.saveUp.length > 0 && <> · {advisor.saveUp.length} save up</>}
                  {advisor.earn.length > 0 && <> · {advisor.earn.length} to earn</>}
                  {advisor.locked.length > 0 && <> · {advisor.locked.length} locked</>}
                </>
              )}
            </span>
          </CardTitle>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-stone-500 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {open && (
          <CardDescription className="text-xs pt-1">
            Every preset item you don&apos;t own that beats what&apos;s in that slot — grouped by
            what&apos;s holding it back, biggest gain first. Score = attack + damage bonus for the
            style (defence ignored), compared against your best owned item from the preset pool;
            exact DPS belongs to the{" "}
            <a
              href="https://oldschool.runescape.wiki/w/Calculator/Combat/DPS"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted hover:text-amber-300"
            >
              wiki calculator
            </a>
            .
          </CardDescription>
        )}
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {empty ? (
            <p className="text-xs text-stone-400">
              Nothing to buy — every item the presets want is either already on your account or a
              downgrade for its slot. Rare.
            </p>
          ) : (
            <>
              {advisor.buyNow.length > 0 && (
                <AdvisorSection
                  title={`Buy now (${advisor.buyNow.length})`}
                  accent="emerald"
                  suggestions={advisor.buyNow}
                  coins={coins}
                  planned={planned}
                  total={advisor.buyNowTotal}
                />
              )}
              {advisor.saveUp.length > 0 && (
                <AdvisorSection
                  title={`Save up for (${advisor.saveUp.length})`}
                  accent="amber"
                  suggestions={advisor.saveUp}
                  coins={coins}
                  planned={planned}
                />
              )}
              {advisor.earn.length > 0 && (
                <AdvisorSection
                  title={`Earn in game — untradeable (${advisor.earn.length})`}
                  accent="stone"
                  suggestions={advisor.earn}
                  coins={coins}
                  planned={planned}
                />
              )}
              {advisor.locked.length > 0 && (
                <AdvisorSection
                  title={`Locked — train or quest first (${advisor.locked.length})`}
                  accent="stone"
                  suggestions={advisor.locked}
                  coins={coins}
                  planned={planned}
                />
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function AdvisorSection({
  title,
  accent,
  suggestions,
  coins,
  planned,
  total,
}: {
  title: string;
  accent: "emerald" | "amber" | "stone";
  suggestions: UpgradeSuggestion[];
  coins: number | null;
  planned: Set<string>;
  /** buy-now only: cost of buying the whole section */
  total?: number;
}) {
  const titleCls =
    accent === "emerald" ? "text-emerald-300" : accent === "amber" ? "text-amber-300" : "text-stone-300";
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${titleCls}`}>{title}</p>
        {total !== undefined && total > 0 && coins !== null && (
          <span className="text-[11px] text-stone-500">
            · everything: <b className="text-stone-300">{formatPrice(total)}</b>
            {coins >= total ? " (within budget)" : ` (budget ${formatPrice(coins)})`}
          </span>
        )}
      </div>
      <div className="divide-y divide-stone-800/70 rounded-md border border-stone-800 bg-stone-950/40">
        {suggestions.map((s) => (
          <AdvisorRow key={s.item.id} s={s} planned={planned} />
        ))}
      </div>
    </div>
  );
}

function AdvisorRow({ s, planned }: { s: UpgradeSuggestion; planned: Set<string> }) {
  const style = s.styles[0] ?? "Melee";
  return (
    <div className="px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <a
        href={wikiUrl(s.item.name)}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-stone-200 hover:text-amber-300 hover:underline"
      >
        {s.item.name}
      </a>
      <span className="text-[11px] uppercase tracking-wide text-stone-500">
        {SLOT_LABELS[s.slotKey]} · {style}
      </span>
      <span className="text-xs text-stone-400">
        <b className="text-emerald-400">+{s.gain}</b> score{" "}
        {s.ownedBestName ? (
          <>over your {s.ownedBestName}</>
        ) : (
          <>— this slot is empty</>
        )}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        <Badge className="border-stone-700 bg-stone-900 text-stone-400">
          in {s.bossKeys.length} boss{s.bossKeys.length === 1 ? "" : "es"}
        </Badge>
        {s.price !== null ? (
          <Badge
            className={
              s.affordable === true
                ? "border-emerald-800/50 bg-emerald-950/40 text-emerald-300"
                : "border-amber-800/50 bg-amber-950/30 text-amber-300"
            }
          >
            {formatPrice(s.price)}
            {s.affordable === true ? " · affordable" : s.affordable === false ? " · over budget" : ""}
          </Badge>
        ) : (
          <Badge className="border-stone-700 bg-stone-900 text-stone-500">untradeable — earn it</Badge>
        )}
        {s.locks.slice(0, 2).map((l, i) =>
          l.type === "level" ? (
            <Badge key={i} className="border-amber-800/50 bg-amber-950/30 text-amber-300">
              <AlertTriangle className="h-3 w-3 mr-0.5" aria-hidden />
              {l.skill} {l.current ?? "?"} → {l.required}
            </Badge>
          ) : planned.has(l.key) ? (
            <Link
              key={i}
              href="/"
              title={`${questName(l.key)} is already on your plan — view it`}
              className="inline-flex items-center rounded-full border border-emerald-800/50 bg-emerald-950/40 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 underline decoration-dotted underline-offset-2 transition-colors hover:border-emerald-600 hover:text-emerald-200"
            >
              <CheckCircle2 className="h-3 w-3 mr-0.5" aria-hidden />
              planned: {questName(l.key)}
            </Link>
          ) : planned.has(l.key) ? (
            <Link
              key={i}
              href="/"
              title={`${questName(l.key)} is already on your plan — view it`}
              className="inline-flex items-center rounded-full border border-emerald-800/50 bg-emerald-950/40 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 underline decoration-dotted underline-offset-2 transition-colors hover:border-emerald-600 hover:text-emerald-200"
            >
              <CheckCircle2 className="h-3 w-3 mr-0.5" aria-hidden />
              planned: {questName(l.key)}
            </Link>
          ) : (
            <Link
              key={i}
              href={planUrl(l.key)}
              title={`Track ${questName(l.key)} in the planner`}
              className="inline-flex items-center rounded-full border border-amber-800/50 bg-amber-950/30 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 underline decoration-dotted underline-offset-2 transition-colors hover:border-amber-600 hover:text-amber-200"
            >
              quest: {questName(l.key)}
            </Link>
          ),
        )}
      </span>
    </div>
  );
}

function BossDetail({
  boss,
  verdict,
  coins,
  planned,
}: {
  boss: Boss;
  verdict: BossVerdict;
  coins: number | null;
  planned: Set<string>;
}) {
  return (
    <div className="space-y-4">
      {/* requirements */}
      <Card className="border-stone-800 bg-stone-900/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-stone-200">
            <Swords className="h-4 w-4 text-amber-300" aria-hidden />
            {boss.name}
            <a
              href={wikiUrl(boss.wiki)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] font-normal text-stone-500 hover:text-amber-300"
            >
              wiki <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </CardTitle>
          <CardDescription className="text-xs">
            {boss.tagline} {boss.location} · {boss.duration}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* hard requirements */}
          {(verdict.skillGaps.length > 0 || verdict.questGates.length > 0) && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Required
              </p>
              {verdict.skillGaps.map((g) => (
                <div key={g.skill} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className={g.met ? "text-emerald-400" : "text-amber-300"}>
                    {g.met ? "✓" : "✗"} {g.skill} {g.required}
                    {!g.met && g.current !== null && (
                      <span className="text-stone-500"> (you: {g.current})</span>
                    )}
                  </span>
                  {g.note && <span className="text-xs text-stone-500">{g.note}</span>}
                </div>
              ))}
              {verdict.questGates.map((q) => (
                <div key={q.key} className="flex items-baseline gap-x-2 text-sm">
                  <span className={q.done ? "text-emerald-400" : "text-amber-300"}>
                    {q.done ? "✓" : q.done === false ? "✗" : "•"} quest: {questName(q.key)}
                  </span>
                  {!q.done &&
                    (planned.has(q.key) ? (
                      <Link
                        href="/"
                        title="Already on your plan — view it"
                        className="inline-flex items-center gap-0.5 text-xs text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
                      >
                        <CheckCircle2 className="h-3 w-3" aria-hidden />
                        planned
                      </Link>
                    ) : (
                      <Link
                        href={planUrl(q.key)}
                        className="text-xs text-amber-400/80 underline underline-offset-2 hover:text-amber-300"
                      >
                        plan it →
                      </Link>
                    ))}
                </div>
              ))}
            </div>
          )}
          {/* recommended */}
          {(verdict.recMet.length > 0 || verdict.recGaps.length > 0) && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Recommended
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...verdict.recMet, ...verdict.recGaps].map((g) => (
                  <Badge
                    key={g.skill}
                    className={
                      g.met
                        ? "border-emerald-800/50 bg-emerald-950/40 text-emerald-300"
                        : "border-amber-800/50 bg-amber-950/30 text-amber-300"
                    }
                  >
                    {g.skill} {g.current ?? "?"}/{g.required}
                  </Badge>
                ))}
              </div>
              {verdict.recGaps.some((g) => g.note) && (
                <ul className="text-xs text-stone-500 space-y-0.5">
                  {verdict.recGaps
                    .filter((g) => g.note)
                    .map((g) => (
                      <li key={g.skill}>
                        {g.skill} {g.current} → {g.required}: {g.note}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
          {boss.notes && (
            <p className="text-xs leading-relaxed text-stone-400">
              {linkifyQuests(boss.notes, planned)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* presets */}
      {verdict.presets.map((p) => (
        <PresetCard key={p.preset.name} presetCheck={p} coins={coins} planned={planned} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- preset card */

function PresetCard({
  presetCheck,
  coins,
  planned,
}: {
  presetCheck: PresetCheck;
  coins: number | null;
  planned: Set<string>;
}) {
  const { preset, style, items, ownedCount, knownOwned, missingCost, affordableCount, overBudgetCount } =
    presetCheck;
  const bySlot = new Map(items.map((i) => [i.slotKey, i]));
  const totalSlots = items.length;

  // missing + buyable items as a cheapest-first shopping list with running total
  const shoppingList = items
    .filter((i) => i.buyable && i.price !== null)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
    .reduce<{ item: ItemCheck; price: number; running: number }[]>((acc, i) => {
      const prev = acc.length ? acc[acc.length - 1].running : 0;
      acc.push({ item: i, price: i.price ?? 0, running: prev + (i.price ?? 0) });
      return acc;
    }, []);

  return (
    <Card className="border-stone-800 bg-stone-900/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-stone-200">
          {preset.name} <span className="text-xs font-normal text-stone-500">· {style}</span>
        </CardTitle>
        <CardDescription className="text-xs">
          {linkifyQuests(preset.description, planned)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* rollup — skipped for note-only presets (e.g. Gauntlet, gear crafted in-raid) */}
        {knownOwned && totalSlots > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-stone-400">
              <b className={ownedCount === totalSlots ? "text-emerald-300" : "text-stone-200"}>
                {ownedCount}/{totalSlots}
              </b>{" "}
              items owned
            </span>
            {missingCost !== null && missingCost > 0 && (
              <span className="text-stone-500">·</span>
            )}
            {missingCost !== null && missingCost > 0 && (
              <span className="inline-flex items-center gap-1 text-stone-400">
                <Banknote className="h-3 w-3 text-amber-400/80" aria-hidden />
                missing buyables: <b className="text-stone-200">{formatPrice(missingCost)}</b>
                {coins !== null && (
                  <span className={coins >= missingCost ? "text-emerald-400" : "text-amber-300"}>
                    {coins >= missingCost ? "(within budget)" : `(budget: ${formatPrice(coins)})`}
                  </span>
                )}
              </span>
            )}
            {coins !== null && affordableCount + overBudgetCount > 0 && (
              <span className="text-stone-500">
                · {affordableCount} affordable / {overBudgetCount} over budget
              </span>
            )}
          </p>
        )}

        {/* shopping list — missing & buyable, cheapest first */}
        {knownOwned && shoppingList.length > 0 && (
          <details className="rounded-md border border-stone-800 bg-stone-950/60 px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-stone-300 marker:text-stone-600 hover:text-stone-100">
              Shopping list — {shoppingList.length} to buy, cheapest first
              {coins !== null &&
                missingCost !== null &&
                missingCost > 0 &&
                (coins >= missingCost ? " (all within budget)" : ` (total ${formatPrice(missingCost)})`)}
            </summary>
            <ol className="mt-2 space-y-1 text-xs">
              {shoppingList.map((entry, i) => (
                <li key={entry.item.name} className="flex items-baseline gap-2">
                  <span className="text-stone-600 tabular-nums">{i + 1}.</span>
                  <span className="text-stone-300">{entry.item.name}</span>
                  <span className="ml-auto flex items-baseline gap-2 tabular-nums">
                    {coins !== null && (
                      <span className={entry.price <= coins ? "text-emerald-400" : "text-amber-300"}>
                        {entry.price <= coins ? "affordable" : "over budget"}
                      </span>
                    )}
                    <span className="text-stone-400">{formatPrice(entry.price)}</span>
                    <span className="text-stone-600 w-16 text-right">
                      Σ {formatPrice(entry.running)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {/* slot rows — skipped for note-only presets (empty slots) */}
        {totalSlots > 0 && (
        <div className="divide-y divide-stone-800/70 rounded-md border border-stone-800 bg-stone-950/40">
          {SLOT_KEYS.filter((k) => preset.slots[k]).map((k) => {
            const check = bySlot.get(k);
            if (!check) return null;
            return (
              <SlotRow
                key={k}
                slotLabel={SLOT_LABELS[k]}
                check={check}
                style={style}
                planned={planned}
              />
            );
          })}
        </div>
        )}

        {/* inventory */}
        {preset.inventory.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              Bring
            </p>
            <ul className="text-xs text-stone-400 space-y-0.5">
              {preset.inventory.map((inv, i) => (
                <li key={i}>
                  <b className="text-stone-300">
                    {inv.name}
                    {inv.qty ? ` ×${inv.qty}` : ""}
                  </b>
                  {inv.note && <span className="text-stone-500"> — {inv.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preset.notes && (
          <p className="text-xs leading-relaxed text-stone-500 border-t border-stone-800/70 pt-2">
            {linkifyQuests(preset.notes, planned)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------- slot row */

function SlotRow({
  slotLabel,
  check,
  style,
  planned,
}: {
  slotLabel: string;
  check: ItemCheck;
  style: string;
  planned: Set<string>;
}) {
  const { item, owned, locks, price, affordable } = check;
  return (
    <div className="px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-stone-500">
        {slotLabel}
      </span>
      <a
        href={wikiUrl(check.name)}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-stone-200 hover:text-amber-300 hover:underline"
      >
        {check.name}
      </a>

      {/* stat chips */}
      {item && (
        <span className="flex flex-wrap gap-1">
          {statChips(item, style).map((c) => (
            <span
              key={c.label}
              className="rounded bg-stone-900 px-1.5 py-0.5 text-[10px] tabular-nums text-stone-400"
            >
              +{c.value} {c.label}
            </span>
          ))}
        </span>
      )}

      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {owned === true && (
          <Badge className="border-emerald-800/50 bg-emerald-950/40 text-emerald-300">
            <CheckCircle2 className="h-3 w-3 mr-0.5" aria-hidden />
            owned
            {check.ownedFrom && check.ownedFrom.includes("equipment") && " (worn)"}
          </Badge>
        )}
        {owned === false && (
          <>
            {locks.length === 0 && price !== null && (
              <Badge className="border-stone-700 bg-stone-900 text-stone-400">
                buy · {formatPrice(price)}
                {affordable === true && (
                  <span className="ml-1 text-emerald-400">affordable</span>
                )}
                {affordable === false && <span className="ml-1 text-amber-300">over budget</span>}
              </Badge>
            )}
            {locks.length === 0 && price === null && (
              <Badge className="border-stone-700 bg-stone-900 text-stone-500">
                untradeable — earn it
              </Badge>
            )}
            {locks.map((l, i) =>
              l.type === "level" ? (
                <Badge
                  key={i}
                  className="border-amber-800/50 bg-amber-950/30 text-amber-300"
                  title={`${l.skill} ${l.current ?? "?"} → ${l.required}`}
                >
                  <AlertTriangle className="h-3 w-3 mr-0.5" aria-hidden />
                  {l.skill} {l.required}
                  {l.current !== null ? ` (${l.current})` : ""}
                </Badge>
              ) : planned.has(l.key) ? (
                <Link
                  key={i}
                  href="/"
                  title={`${questName(l.key)} is already on your plan — view it`}
                  className="inline-flex items-center rounded-full border border-emerald-800/50 bg-emerald-950/40 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 underline decoration-dotted underline-offset-2 transition-colors hover:border-emerald-600 hover:text-emerald-200"
                >
                  <CheckCircle2 className="h-3 w-3 mr-0.5" aria-hidden />
                  planned: {questName(l.key)}
                </Link>
              ) : (
                <Link
                  key={i}
                  href={planUrl(l.key)}
                  title={`Track ${questName(l.key)} in the planner`}
                  className="inline-flex items-center rounded-full border border-amber-800/50 bg-amber-950/30 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 underline decoration-dotted underline-offset-2 transition-colors hover:border-amber-600 hover:text-amber-200"
                >
                  <AlertTriangle className="h-3 w-3 mr-0.5" aria-hidden />
                  quest: {questName(l.key)}
                </Link>
              ),
            )}
          </>
        )}
        {owned === null && locks.length > 0 && (
          <>
            {locks.map((l, i) =>
              l.type === "level" ? (
                <Badge key={i} className="border-stone-700 bg-stone-900 text-stone-500">
                  {l.skill} {l.required}
                </Badge>
              ) : planned.has(l.key) ? (
                <Link
                  key={i}
                  href="/"
                  title={`${questName(l.key)} is already on your plan — view it`}
                  className="inline-flex items-center rounded-full border border-emerald-800/50 bg-emerald-950/40 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 underline decoration-dotted underline-offset-2 hover:border-emerald-600 hover:text-emerald-200"
                >
                  <CheckCircle2 className="h-3 w-3 mr-0.5" aria-hidden />
                  planned: {questName(l.key)}
                </Link>
              ) : (
                <Link
                  key={i}
                  href={planUrl(l.key)}
                  title={`Track ${questName(l.key)} in the planner`}
                  className="inline-flex items-center rounded-full border border-stone-700 bg-stone-900 px-2.5 py-0.5 text-[11px] font-medium text-stone-400 underline decoration-dotted underline-offset-2 hover:border-amber-700/70 hover:text-amber-200"
                >
                  quest: {questName(l.key)}
                </Link>
              ),
            )}
          </>
        )}
      </span>
    </div>
  );
}
