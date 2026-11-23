import { NextResponse } from "next/server";
import { GEAR } from "@/lib/boss-data";
import { parseGePrice } from "@/lib/ge-price";

export const dynamic = "force-dynamic";

/**
 * Live GE prices for the gear pool — overlaid client-side on the build-time
 * snapshot in gear.json. No user data is involved (public item ids only).
 *
 * Two sources, best first:
 *  1. Jagex's bulk pricing API — one request covering every item. Some
 *     networks can't resolve it (NXDOMAIN), so it's a try-first, not a given.
 *  2. The per-item item-DB endpoint the build script snapshots from. On a
 *     cold boot it pulls the WHOLE pool in one polite serial crawl, so the
 *     first response already carries complete live prices; steady-state
 *     re-validations top up ~20 missing items at a time.
 *
 * Refresh cadence: at most ONE upstream refresh per 30 minutes once the
 * cache is warm. A cold instance's first request waits for the boot crawl
 * rather than returning an empty map — after that, GETs answer from cache
 * immediately (refreshes run in the background and can't be doubled up).
 */

type PriceMap = Record<string, number>;
type PriceSource = "bulk" | "crawl"; // which upstream filled the cache

const STALE_AFTER_MS = 30 * 60 * 1000; // one upstream refresh per half hour, max
const BACKFILL_PER_CALL = 20; // polite steady-state top-up cap
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cache: { at: number; prices: PriceMap; source: PriceSource } = { at: 0, prices: {}, source: "crawl" };
let refreshing: Promise<void> | null = null;

function isStale(): boolean {
  return Date.now() - cache.at > STALE_AFTER_MS;
}

/** one request for everything; null when unreachable/invalid */
async function tryBulkEndpoint(): Promise<PriceMap | null> {
  try {
    const res = await fetch("https://prices.runescape.com/api/v1/osrs/latest", {
      headers: { "User-Agent": "osrs-pathfinder-price-refresh/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json())?.data;
    if (!data || typeof data !== "object") return null;
    const out: PriceMap = {};
    for (const g of GEAR) {
      const e = data[String(g.id)];
      const p = e?.avgPrice || e?.high || e?.low;
      if (typeof p === "number" && p > 0) out[String(g.id)] = p;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

async function fetchOne(id: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://services.runescape.com/m=itemdb_oldschool/api/catalogue/detail.json?item=${id}`,
      {
        headers: { "User-Agent": "osrs-pathfinder-gear-builder/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return parseGePrice(data?.item?.current?.price);
  } catch {
    return null; // untradeable, rate-limited or transient — snapshot stands
  }
}

async function refresh() {
  const bulk = await tryBulkEndpoint();
  if (bulk) {
    cache = { at: Date.now(), prices: bulk, source: "bulk" };
    return;
  }
  // Crawl what's missing, merging into what we already have. A cold boot
  // (empty cache) pulls the entire pool so the 30-minute cadence only starts
  // once we're warm; later re-validations stay capped to keep it polite.
  const prices = { ...cache.prices };
  const coldBoot = Object.keys(cache.prices).length === 0;
  const missing = GEAR.filter((g) => prices[String(g.id)] === undefined);
  const target = coldBoot ? missing : missing.slice(0, BACKFILL_PER_CALL);
  for (const g of target) {
    const p = await fetchOne(g.id);
    if (p !== null) prices[String(g.id)] = p;
    await sleep(150);
  }
  cache = { at: Date.now(), prices, source: "crawl" };
}

export async function GET() {
  if (!refreshing && isStale()) {
    refreshing = refresh().finally(() => {
      refreshing = null;
    });
  }
  // Cold start: wait for the in-flight boot crawl so the first response is
  // warm instead of an empty map (once warm, GETs answer immediately).
  if (refreshing && cache.at === 0) {
    await refreshing;
  }
  return NextResponse.json(
    { fetchedAt: cache.at, prices: cache.prices, source: cache.source },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
