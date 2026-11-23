import { describe, it, expect } from "vitest";
import { parseBossHash, presetStyle, BOSS_BY_KEY } from "./boss-data";

describe("parseBossHash", () => {
  it("maps a known boss key from a hash", () => {
    expect(parseBossHash("#zulrah")).toBe("zulrah");
    expect(parseBossHash("zulrah")).toBe("zulrah");
    expect(parseBossHash("#fight-caves")).toBe("fight-caves");
  });

  it("rejects unknown keys and empty hashes", () => {
    expect(parseBossHash("#not-a-boss")).toBeNull();
    expect(parseBossHash("")).toBeNull();
    expect(parseBossHash("#")).toBeNull();
  });

  it("decodes percent-encoded keys", () => {
    expect(parseBossHash("#king%20black%20dragon")).toBeNull(); // real key has hyphens
    expect(parseBossHash("#king-black-dragon")).toBe("king-black-dragon");
  });
});

describe("presetStyle", () => {
  it("parses the style from the preset name, falling back to the boss's first", () => {
    const zulrah = BOSS_BY_KEY["zulrah"];
    expect(presetStyle(zulrah, zulrah.presets.find((p) => p.name === "Ranged")!)).toBe("Ranged");
    expect(presetStyle(zulrah, zulrah.presets.find((p) => p.name === "Magic")!)).toBe("Magic");
    const fc = BOSS_BY_KEY["fight-caves"];
    expect(presetStyle(fc, fc.presets[0])).toBe("Ranged"); // "Budget" has no style word
  });
});
