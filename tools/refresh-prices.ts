/**
 * Refresh ONLY the GE prices in src/data/gear.json.
 *
 * Unlike tools/build-gear.ts (which regenerates the whole file from the
 * osrs-db dataset), this needs no dataset downloads: it reads the existing
 * item ids, fetches current prices from the Jagex item DB with a polite
 * serial crawl, overwrites prices that resolve, and leaves everything else
 * (untradeable nulls, transient failures) at its current value. It then
 * bumps the priceSnapshot timestamp and writes back in build-gear's exact
 * 1-space format, so the diff is prices + timestamp only.
 *
 * A 6-hour price cache in .data-cache/prices.json (gitignored, shared with
 * build-gear.ts) makes local re-runs cheap; pass --force to bypass it.
 *
 * Run: node tools/refresh-prices.ts [--force]
 */

import fs from "node:fs";
import path from "node:path";
import { parseGePrice } from "../src/lib/ge-price.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const GEAR_PATH = path.join(ROOT, "src/data/gear.json");
const CACHE = path.join(ROOT, ".data-cache");
const PRICE_CACHE = path.join(CACHE, "prices.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FORCE = process.argv.includes("--force");

const gear = JSON.parse(fs.readFileSync(GEAR_PATH, "utf8"));
const priceCache: Record<string, { price: number | null; fetchedAt: string }> = fs.existsSync(
  PRICE_CACHE,
)
  ? JSON.parse(fs.readFileSync(PRICE_CACHE, "utf8"))
  : {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPrice(id: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://services.runescape.com/m=itemdb_oldschool/api/catalogue/detail.json?item=${id}`,
      {
        headers: { "User-Agent": "osrs-pathfinder-gear-builder/1.0" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return parseGePrice(data?.item?.current?.price);
  } catch {
    return null; // untradeable or transient — keep the current snapshot value
  }
}

let fetched = 0;
let updated = 0;
for (const it of gear.items) {
  const cached = priceCache[it.id];
  const freshCache =
    !FORCE && cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS;

  let price: number | null;
  if (freshCache) {
    price = cached.price;
  } else {
    price = await fetchPrice(it.id);
    priceCache[it.id] = { price, fetchedAt: new Date().toISOString() };
    fetched++;
    await sleep(150); // the item DB soft-throttles bursts
  }
  if (price !== null) {
    it.price = price;
    updated++;
  }
}

fs.mkdirSync(CACHE, { recursive: true });
fs.writeFileSync(PRICE_CACHE, JSON.stringify(priceCache, null, 1));
gear.meta.priceSnapshot = new Date().toISOString();
fs.writeFileSync(GEAR_PATH, JSON.stringify(gear, null, 1) + "\n");

console.log(
  `gear.json: ${updated} prices refreshed, ${fetched} fetched (${gear.items.length - fetched} cached), snapshot ${gear.meta.priceSnapshot}`,
);
