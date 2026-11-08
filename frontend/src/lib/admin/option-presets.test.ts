import { describe, expect, it } from "vitest";
import { OPTION_PRESETS, splitValues } from "./option-presets";

describe("option presets", () => {
  it("suggest distinct options, each with distinct values", () => {
    expect(new Set(OPTION_PRESETS.map((p) => p.name.toLowerCase())).size).toBe(OPTION_PRESETS.length);
    for (const p of OPTION_PRESETS) expect(new Set(p.values.map((v) => v.toLowerCase())).size).toBe(p.values.length);
  });
});

describe("splitValues", () => {
  it("splits on commas and new lines, trims, and drops blanks and repeats", () => {
    expect(splitValues("Middle, Side ,\n free,, side")).toEqual(["Middle", "Side", "free"]);
    expect(splitValues("  ")).toEqual([]);
  });
});
