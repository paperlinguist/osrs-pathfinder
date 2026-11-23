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
 *  2. The per-item item-DB endpoint the build script snapshots from. It
 *     soft-rate-limits by IP (empty 200 bodies after ~30 rapid requests), so
 *     the crawl is incremental: each stale cache serves instantly, then tops
 *     up ~20 missing items in the background across calls.
 *
 * GET always answers from cache immediately — refreshes never block.
 */

type PriceMap = Record<string, number>;

const STALE_AFTER_MS = 30 * 60 * 1000; // full refresh at most half-hourly
const TOPUP_AFTER_MS = 90 * 1000; // incomplete cache may keep topping up
const BACKFILL_PER_CALL = 20; // polite crawl cap — coverage builds over visits
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRADEABLE_COUNT = GEAR.filter((g) => g.price !== null).length;

let cache: { at: number; prices: PriceMap } = { at: 0, prices: {} };
let refreshing: Promise<void> | null = null;

/** full caches go stale hourly; partial ones (bulk endpoint unreachable, crawl
 *  still working) may top up again after a short cooldown */
function isStale(): boolean {
  const age = Date.now() - cache.at;
  const coverage = Object.keys(cache.prices).length;
  const complete = coverage >= TRADEABLE_COUNT - 4; // some tradeables 404 for real
  return complete ? age > STALE_AFTER_MS : age > TOPUP_AFTER_MS;
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
    cache = { at: Date.now(), prices: bulk };
    return;
  }
  // crawl a slice of what's missing, merging into what we already have
  const prices = { ...cache.prices };
  const missing = GEAR.filter((g) => prices[String(g.id)] === undefined).slice(0, BACKFILL_PER_CALL);
  for (const g of missing) {
    const p = await fetchOne(g.id);
    if (p !== null) prices[String(g.id)] = p;
    await sleep(150);
  }
  cache = { at: Date.now(), prices };
}

export async function GET() {
  if (!refreshing && isStale()) {
    refreshing = refresh().finally(() => {
      refreshing = null;
    });
  }
  return NextResponse.json(
    { fetchedAt: cache.at, prices: cache.prices },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
