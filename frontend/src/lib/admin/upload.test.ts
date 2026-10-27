import { describe, expect, it } from "vitest";
import { checkFile, fitWithin, MAX_SIDE } from "./upload";

describe("fitWithin", () => {
  it("shrinks the longest side to the limit and keeps the shape", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });
  it("never enlarges, and never reaches zero", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_SIDE, 10)).toEqual({ width: MAX_SIDE, height: 10 });
    expect(fitWithin(100_000, 1)).toEqual({ width: MAX_SIDE, height: 1 });
  });
});

describe("checkFile", () => {
  it("accepts the image types the API takes", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif"]) expect(checkFile({ type, size: 1000, name: "a" })).toBeNull();
  });
  it("refuses other types and absurdly large files, by name", () => {
    expect(checkFile({ type: "application/pdf", size: 1000, name: "menu.pdf" })).toMatch(/menu\.pdf isn't a JPEG/);
    expect(checkFile({ type: "image/gif", size: 1000, name: "a.gif" })).toMatch(/isn't/);
    expect(checkFile({ type: "image/jpeg", size: 60 * 1024 * 1024, name: "huge.jpg" })).toMatch(/too large/);
  });
});
