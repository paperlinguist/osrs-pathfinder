import { describe, it, expect } from "vitest";
import { parseGePrice } from "./ge-price";
import { GEAR, PRICE_SNAPSHOT_AT, applyLivePrices, gearFor } from "./boss-data";

describe("parseGePrice", () => {
  it("parses the item DB's price formats", () => {
    expect(parseGePrice(1025)).toBe(1025);
    expect(parseGePrice("2.3k")).toBe(2300);
    expect(parseGePrice("1.2m")).toBe(1_200_000);
    expect(parseGePrice("14,300")).toBe(14_300);
    expect(parseGePrice("-")).toBeNull();
    expect(parseGePrice(null)).toBeNull();
    expect(parseGePrice("nope")).toBeNull();
  });
});

describe("applyLivePrices", () => {
  it("overlays positive live prices and ignores junk", () => {
    const rcb = gearFor("Rune crossbow")!;
    const snapshot = rcb.price;
    try {
      const n = applyLivePrices({
        [String(rcb.id)]: 123_456, // sane override
        [String(gearFor("Amulet of glory")!.id)]: -5, // ignored
        "999999999": 42, // unknown id — ignored
      });
      expect(rcb.price).toBe(123_456);
      expect(n).toBe(1);
      expect(gearFor("Amulet of glory")!.price).not.toBe(-5);
    } finally {
      rcb.price = snapshot; // don't poison other tests in this file
    }
  });

  it("the snapshot timestamp ships in the generated data", () => {
    expect(PRICE_SNAPSHOT_AT).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(GEAR.length).toBeGreaterThan(80);
  });
});
