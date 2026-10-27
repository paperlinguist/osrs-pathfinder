import { NextRequest, NextResponse } from "next/server";
import { PlayerSkills, SKILL_NAMES, combatLevel } from "@/lib/quest-data";

export const dynamic = "force-dynamic";

/** WOM metric key -> canonical skill name */
const WOM_KEY_MAP: Record<string, string> = {
  attack: "Attack", defence: "Defence", strength: "Strength", hitpoints: "Hitpoints",
  ranged: "Ranged", prayer: "Prayer", magic: "Magic", cooking: "Cooking",
  woodcutting: "Woodcutting", fletching: "Fletching", fishing: "Fishing",
  firemaking: "Firemaking", crafting: "Crafting", smithing: "Smithing",
  mining: "Mining", herblore: "Herblore", agility: "Agility", thieving: "Thieving",
  slayer: "Slayer", farming: "Farming", runecrafting: "Runecraft", hunter: "Hunter",
  construction: "Construction", sailing: "Sailing",
};

const HISCORES_KEY_MAP: Record<string, string> = {
  Attack: "Attack", Defence: "Defence", Strength: "Strength", Hitpoints: "Hitpoints",
  Ranged: "Ranged", Prayer: "Prayer", Magic: "Magic", Cooking: "Cooking",
  Woodcutting: "Woodcutting", Fletching: "Fletching", Fishing: "Fishing",
  Firemaking: "Firemaking", Crafting: "Crafting", Smithing: "Smithing",
  Mining: "Mining", Herblore: "Herblore", Agility: "Agility", Thieving: "Thieving",
  Slayer: "Slayer", Farming: "Farming", Runecraft: "Runecraft", Runecrafting: "Runecraft",
  Hunter: "Hunter", Construction: "Construction", Sailing: "Sailing",
};

async function fetchWom(username: string): Promise<PlayerSkills | null> {
  try {
    const res = await fetch(
      `https://api.wiseoldman.net/v2/players/${encodeURIComponent(username)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000), cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const skills = data?.latestSnapshot?.data?.skills;
    if (!skills) return null;
    const levels: Record<string, number> = {};
    const xp: Record<string, number> = {};
    for (const [k, v] of Object.entries(skills) as [string, { level?: number; experience?: number }][]) {
      const name = WOM_KEY_MAP[k];
      if (!name || typeof v?.level !== "number") continue;
      levels[name] = v.level;
      xp[name] = v.experience ?? 0;
    }
    if (!Object.keys(levels).length) return null;
    return {
      levels, xp,
      username: data.displayName ?? username,
      combatLevel: typeof data.combatLevel === "number" ? Math.floor(data.combatLevel) : combatLevel(levels),
      source: "wiseoldman",
    };
  } catch {
    return null;
  }
}

async function fetchHiscores(username: string): Promise<PlayerSkills | null> {
  try {
    const res = await fetch(
      `https://services.runescape.com/m=hiscore_oldschool/index_lite.json?player=${encodeURIComponent(username)}`,
      { headers: { "User-Agent": "QuestPathTool/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(12000), redirect: "follow", cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const levels: Record<string, number> = {};
    const xp: Record<string, number> = {};
    for (const s of data?.skills ?? []) {
      const name = HISCORES_KEY_MAP[s?.name];
      if (!name) continue;
      const lvl = typeof s.level === "string" ? parseInt(s.level, 10) : s.level;
      const x = typeof s.xp === "string" ? parseInt(s.xp, 10) : s.xp;
      if (typeof lvl !== "number" || Number.isNaN(lvl)) continue;
      levels[name] = lvl;
      xp[name] = Number.isNaN(x) ? 0 : x;
    }
    if (!Object.keys(levels).length) return null;
    return {
      levels, xp, username: data.name ?? username,
      combatLevel: combatLevel(levels),
      source: "hiscores",
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username")?.trim();
  if (!username || !/^[\w \-]{1,20}$/.test(username)) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }

  const player = (await fetchWom(username)) ?? (await fetchHiscores(username));
  if (!player) {
    return NextResponse.json(
      { error: `Player "${username}" not found on the hiscores (unranked names, banned names, or typo).` },
      { status: 404 },
    );
  }

  // ensure every canonical skill has an entry (level 1 default)
  for (const s of SKILL_NAMES) {
    if (!(s in player.levels)) { player.levels[s] = 1; player.xp[s] = 0; }
  }
  return NextResponse.json(player);
}
