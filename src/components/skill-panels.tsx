"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Quest, formatHours, formatMinutes, formatXp, trainHours } from "@/lib/quest-data";
import { SkillGap } from "@/lib/resolver";
import { AnimatePresence, motion } from "framer-motion";
import { Clock } from "lucide-react";

function wikiUrl(name: string) {
  return `https://oldschool.runescape.wiki/w/${encodeURIComponent(name).replace(/%2F/g, "/").replace(/%20/g, "_")}`;
}

/** DOM anchor of a skill's suggestion group — the graph's gate "+" jumps here. */
export function skillSuggestAnchorId(skill: string): string {
  return `skill-suggest-${skill.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** "≈3h 20m at typical rates" sentence fragment, or null for rate-less skills. */
function hoursHint(x: { skill: string; xpNeeded: number }): string | null {
  const h = trainHours(x.skill, x.xpNeeded);
  return h === null ? null : `≈${formatHours(h)} at typical training rates`;
}

/* ------------------------------------------------------ requirement chip */

const REQ_CHIP_CLASSES: Record<SkillGap["status"], string> = {
  met: "bg-stone-800/70 text-stone-400 border-stone-700/80",
  "covered-by-quest-xp": "bg-emerald-900/50 text-emerald-300 border-emerald-700/50",
  "boost-ok": "bg-amber-900/50 text-amber-300 border-amber-700/50",
  train: "bg-red-900/60 text-red-300 border-red-700/60",
};

/* ------------------------------------------------- shared light tooltip box */

/**
 * Light "inverted" tooltip surface — the dark UI around it makes a light box
 * the most readable choice, and it fixes the base component's dark-mode
 * `text-primary-foreground` (near-black-on-near-black) default.
 */
export const TOOLTIP_BOX =
  "bg-stone-100 text-stone-800 border border-stone-300 shadow-xl";

/** Arrow filled to match TOOLTIP_BOX. */
export const TOOLTIP_ARROW = "bg-stone-100 fill-stone-100";

const TOOLTIP_STATUS: Record<SkillGap["status"], { label: string; cls: string }> = {
  met: { label: "requirement met", cls: "text-emerald-700" },
  "covered-by-quest-xp": { label: "covered by quest XP", cls: "text-emerald-700" },
  "boost-ok": { label: "boostable — no grind", cls: "text-amber-700" },
  train: { label: "must train first", cls: "text-red-700" },
};

const b = { className: "font-semibold text-stone-900" }; // bold-number helper

function ChipTooltipBody({ gap }: { gap: SkillGap }) {
  const st = TOOLTIP_STATUS[gap.status];
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-4 border-b border-stone-300 pb-1.5 mb-1">
        <span className="font-semibold text-stone-900 text-xs">
          {gap.skill} {gap.required}
        </span>
        <span className={`text-[11px] font-medium ${st.cls}`}>{st.label}</span>
      </div>
      {gap.status === "met" && (
        <>
          <p>
            You have <b {...b}>{gap.skill} {gap.base}</b> — this requirement is fully satisfied.
          </p>
          <p className="text-stone-500">No action needed for this skill.</p>
        </>
      )}
      {gap.status === "boost-ok" && (
        <>
          <p>
            Your current level is <b {...b}>{gap.base}</b>, and this requirement can be reached
            with potions / spicy stews.
          </p>
          <p className="text-stone-500">Temporary boosts count — no training needed.</p>
        </>
      )}
      {gap.status === "covered-by-quest-xp" && (
        <>
          <p>
            Your base level is <b {...b}>{gap.base}</b>, but quest XP from earlier quests in this
            path raises you to <b {...b}>{gap.effective}</b>.
          </p>
          <p className="text-stone-500">
            Level {gap.required} is covered once you reach this quest in the plan.
          </p>
        </>
      )}
      {gap.status === "train" && (gap.requiredToStart ? (
        <>
          <p>
            This quest checks the level <span className="font-medium">at start</span>, so
            boosts don&apos;t count. You are <b {...b}>{gap.skill} {gap.base}</b>.
          </p>
          <p>
            Train <b {...b}>+{gap.deficit} level{gap.deficit > 1 ? "s" : ""}</b> to {gap.required}
            {" "}· about <b {...b}>{formatXp(gap.xpNeeded)} XP</b>.
          </p>
        </>
      ) : (
        <>
          <p>
            You are <b {...b}>{gap.skill} {gap.base}</b>
            {gap.effective > gap.base ? (
              <> — <b {...b}>{gap.effective}</b> with quest XP, still short of {gap.required}</>
            ) : null}
            .
          </p>
          <p>
            Train <b {...b}>+{gap.deficit} level{gap.deficit > 1 ? "s" : ""}</b> · about{" "}
            <b {...b}>{formatXp(gap.xpNeeded)} XP</b>.
          </p>
        </>
      ))}
      {gap.status === "train" && hoursHint(gap) && (
        <p className="text-stone-500">That is {hoursHint(gap)}.</p>
      )}
    </div>
  );
}

export function ReqChip({ gap }: { gap: SkillGap }) {
  const glyph =
    gap.status === "met" ? "✓"
    : gap.status === "train" ? `⚒ train +${gap.deficit}`
    : gap.status === "boost-ok" ? "⬆ boost"
    : "✦ quest XP";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-[10px] px-1.5 ${REQ_CHIP_CLASSES[gap.status]}`}>
          {gap.skill} {gap.required} <span className="ml-1 opacity-80">{glyph}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={6}
        arrowClassName={TOOLTIP_ARROW}
        className={`text-xs max-w-xs px-3 py-2.5 leading-relaxed ${TOOLTIP_BOX}`}
      >
        <ChipTooltipBody gap={gap} />
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------- unmet skill requirements (ordered) */

export interface UnmetEntry {
  skill: string;
  required: number;
  status: SkillGap["status"];
  base: number;
  effective: number;
  deficit: number;
  xpNeeded: number;
  boostable: boolean;
  requiredToStart: boolean;
  quests: string[]; // names of quests (in path order) imposing this requirement
}

const STATUS_TEXT: Record<SkillGap["status"], { cls: string; label: string }> = {
  met: { cls: "text-stone-400", label: "met" },
  "covered-by-quest-xp": { cls: "text-emerald-300", label: "covered by quest XP" },
  "boost-ok": { cls: "text-amber-300", label: "boostable — no grind" },
  train: { cls: "text-red-300", label: "must train" },
};

export function UnmetRequirementsPanel({
  entries,
  totalTrainXp,
}: {
  entries: UnmetEntry[];
  totalTrainXp: number;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-emerald-900/50 bg-emerald-950/20 px-3 py-2.5">
        <p className="text-xs font-semibold text-emerald-300">
          ✓ Every skill requirement in this path is already met — no training needed.
        </p>
      </div>
    );
  }
  const trainCount = entries.filter((e) => e.status === "train").length;
  return (
    <Collapsible defaultOpen>
      <div className="rounded-md border border-red-900/40 bg-red-950/10 px-3 py-2.5">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left group">
          <span className="text-xs font-semibold text-red-300">
            Skill requirements not met ({entries.length})
            {trainCount > 0 && (
              <span className="ml-2 font-normal text-stone-400">
                {trainCount} need real training · ~{formatXp(totalTrainXp)} XP total
              </span>
            )}
          </span>
          <span className="text-[10px] text-stone-500 group-hover:text-stone-300 shrink-0">
            show / hide ▾
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <ul className="mt-2.5 space-y-1.5">
            {entries.map((e) => (
              <li
                key={`${e.skill}-${e.required}-${e.status}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-relaxed"
              >
                <Badge variant="outline" className={`text-[10px] px-1.5 ${REQ_CHIP_CLASSES[e.status]}`}>
                  {e.skill} {e.required}
                </Badge>
                <span className="text-stone-400">
                  you: {e.base}
                  {e.effective > e.base ? ` → ${e.effective} w/ quest XP` : ""}
                </span>
                <span className={STATUS_TEXT[e.status].cls}>{STATUS_TEXT[e.status].label}</span>
                {e.status === "train" && (
                  <span className="text-red-300/90">
                    +{e.deficit} lv (~{formatXp(e.xpNeeded)} XP
                    {hoursHint(e) ? `, ${hoursHint(e)}` : ""})
                  </span>
                )}
                <span className="text-stone-500">
                  · for {e.quests.slice(0, 3).join(", ")}
                  {e.quests.length > 3 ? ` +${e.quests.length - 3} more` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-stone-600 mt-2">
            Listed in optimal order of first appearance. &quot;Covered by quest XP&quot; and &quot;boostable&quot;
            entries need no grinding — only the red ones do.
          </p>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* -------------------------------------- skill-raising quest suggestions */

export interface QuestSuggestion {
  quest: Quest;
  xp: number; // xp granted for the target skill
  openPrereqs: number; // prereqs neither completed nor in the plan
  minutes: number | null; // estimated playtime of the quest itself
  prereqMinutes: number; // est. playtime of the open prereq closure (0 if none)
  reqs: SkillGap[]; // the quest's own skill reqs vs the player (unmet = red chips)
}

export interface SuggestionGroup {
  skill: string;
  required: number;
  deficit: number;
  xpNeeded: number;
  suggestions: QuestSuggestion[];
}

export type SugSort = "xp" | "eff" | "time" | "reqs";

export const SUG_SORTS: { key: SugSort; label: string }[] = [
  { key: "xp", label: "Most XP" },
  { key: "eff", label: "XP / time" },
  { key: "time", label: "Fastest" },
  { key: "reqs", label: "Fewest reqs" },
];

export function SkillSuggestionsPanel({
  groups,
  addedKeys,
  onToggle,
  onClearAdded,
  sortBy,
  onSortChange,
}: {
  groups: SuggestionGroup[];
  addedKeys: Set<string>;
  onToggle: (key: string) => void;
  onClearAdded: () => void;
  sortBy: SugSort;
  onSortChange: (s: SugSort) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <Card className="border-sky-900/40 bg-stone-900/60">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-sm text-stone-200">
            Raise your training skills with quests
          </CardTitle>
          <CardDescription className="text-xs">
            Quests whose XP rewards target the skills you must train. Adding one slots it into the
            optimal order (high XP first) and its reward counts toward later requirements.
          </CardDescription>
        </div>
        {addedKeys.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAdded}
            className="text-stone-500 hover:text-red-300 hover:bg-stone-900 shrink-0"
          >
            Remove added ({addedKeys.size})
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Sort by
          </span>
          <div
            className="flex overflow-hidden rounded-md border border-stone-700"
            role="group"
            aria-label="Sort suggestions"
          >
            {SUG_SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onSortChange(s.key)}
                aria-pressed={sortBy === s.key}
                className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                  sortBy === s.key
                    ? "bg-sky-700 text-stone-50"
                    : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-stone-600">
            times include the quest&apos;s unmet prerequisites
          </span>
        </div>
        {groups.map((gr) => (
          <div
            key={gr.skill}
            id={skillSuggestAnchorId(gr.skill)}
            className="scroll-mt-24 rounded-md"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 mb-1.5">
              <span className="text-sm font-medium text-stone-200">{gr.skill}</span>
              <span className="text-[11px] text-red-300/90">
                need {gr.required} · train {gr.deficit} lv (~{formatXp(gr.xpNeeded)} XP)
              </span>
            </div>
            {gr.suggestions.length === 0 ? (
              <p className="text-[11px] text-stone-500">
                Every quest granting {gr.skill} XP is already completed or in your plan.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-1.5">
                <AnimatePresence initial={false}>
                  {gr.suggestions.map((s, idx) => {
                    const isAdded = addedKeys.has(s.quest.key);
                    const otherXp = Object.entries(s.quest.xp)
                      .filter(([sk]) => sk !== gr.skill)
                      .map(([sk, x]) => `${sk} ${formatXp(x)}`);
                    const unmetReqs = s.reqs.filter((g) => g.status !== "met");
                    return (
                      <motion.div
                        layout
                        key={s.quest.key}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{
                          duration: 0.25,
                          delay: Math.min(idx * 0.05, 0.25),
                          layout: { duration: 0.25, ease: "easeInOut" },
                        }}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors ${
                          isAdded
                            ? "border-sky-800/60 bg-sky-950/20"
                            : "border-stone-800 bg-stone-950/40 hover:border-stone-700 hover:bg-stone-900/70"
                        }`}
                      >
                      <div className="flex-1 min-w-0">
                        <a
                          href={wikiUrl(s.quest.name)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-stone-100 hover:text-amber-300 hover:underline truncate block"
                        >
                          {s.quest.name}
                        </a>
                        <div className="flex flex-wrap gap-x-2 text-[10px] text-stone-500">
                          <span className="text-emerald-300/90">
                            +{formatXp(s.xp)} {gr.skill} XP
                          </span>
                          {otherXp.length > 0 && <span>+ {otherXp.join(", ")}</span>}
                          <span>{s.quest.difficulty}</span>
                          {s.minutes !== null && (
                            <span className="inline-flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" aria-hidden />
                              ≈{formatMinutes(s.minutes)}
                            </span>
                          )}
                          {s.prereqMinutes > 0 && (
                            <span className="text-amber-400/80">
                              +≈{formatMinutes(s.prereqMinutes)} prereqs
                            </span>
                          )}
                          {s.openPrereqs > 0 && (
                            <span className="text-amber-400/80">
                              {s.openPrereqs} prereq{s.openPrereqs > 1 ? "s" : ""} not in plan
                            </span>
                          )}
                        </div>
                        {/* the quest's own skill reqs — unmet ones stand out in red */}
                        {s.reqs.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {unmetReqs.length > 0 ? (
                              unmetReqs.map((g) => (
                                <ReqChip key={`${g.skill}-${g.required}`} gap={g} />
                              ))
                            ) : (
                              <span className="text-[10px] text-emerald-400/70">
                                ✓ all skill reqs met
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={isAdded ? "secondary" : "outline"}
                        onClick={() => onToggle(s.quest.key)}
                        className={`h-7 px-2.5 text-[11px] shrink-0 transition-transform active:scale-[0.94] ${
                          isAdded
                            ? "bg-sky-900/60 text-sky-200 border border-sky-700/50"
                            : "border-stone-700 text-stone-200 hover:bg-stone-800"
                        }`}
                      >
                        {isAdded ? "✓ added" : "+ add"}
                      </Button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
