import { describe, expect, it } from "vitest";
import type { CategoryRow } from "@/lib/api/admin-catalog";
import { categoryTree, isSlug, productCountText, selfAndDescendants, slugify, validateTaxonomy } from "./taxonomy";

const cat = (id: string, name: string, parentId: string | null = null, sortOrder = 0): CategoryRow => ({ id, name, slug: slugify(name), parentId, sortOrder, active: true, productCount: 0 });

describe("slugs", () => {
  it("makes web addresses from names", () => {
    expect([slugify("Wig Types & Cuts"), slugify("  Café  Bobs! "), slugify("---")]).toEqual(["wig-types-cuts", "cafe-bobs", ""]);
    expect([isSlug("wig-types"), isSlug("Wig"), isSlug("a--b"), isSlug("")]).toEqual([true, false, false, false]);
  });
});

describe("categoryTree", () => {
  it("lists children under their parent, each level in order, with depth", () => {
    const rows = [cat("c", "Hair care", null, 10), cat("a", "Frontal", null, 0), cat("b", "HD lace", "a", 5), cat("d", "Swiss lace", "a", 1), cat("e", "Ultra HD", "b")];
    expect(categoryTree(rows).map((r) => [r.name, r.depth])).toEqual([["Frontal", 0], ["Swiss lace", 1], ["HD lace", 1], ["Ultra HD", 2], ["Hair care", 0]]);
  });
  it("shows a category whose parent is missing at the top, and survives a loop", () => {
    expect(categoryTree([cat("a", "Orphan", "gone")]).map((r) => r.depth)).toEqual([0]);
    expect(categoryTree([cat("a", "A", "b"), cat("b", "B", "a")])).toEqual([]);
  });
  it("finds a category and everything beneath it", () => {
    const rows = [cat("a", "A"), cat("b", "B", "a"), cat("c", "C", "b"), cat("d", "D")];
    expect([...selfAndDescendants(rows, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...selfAndDescendants(rows, "d")]).toEqual(["d"]);
  });
});

describe("validateTaxonomy", () => {
  const f = { name: "Bobs", slug: "bobs", sortOrder: "10", active: true, parentId: "", description: "" };
  it("accepts a good form and a blank slug or order", () => {
    expect(validateTaxonomy(f)).toEqual({});
    expect(validateTaxonomy({ ...f, slug: "", sortOrder: "" })).toEqual({});
  });
  it("asks for a name, a clean slug and a whole-number order", () => {
    expect(validateTaxonomy({ ...f, name: " ", slug: "Bad Slug", sortOrder: "-1" })).toEqual({ name: "Give it a name", slug: expect.any(String), sortOrder: expect.any(String) });
    expect(validateTaxonomy({ ...f, name: "x".repeat(81) }).name).toMatch(/80/);
  });
  it("counts products in words", () => expect([productCountText(1), productCountText(0), productCountText(12)]).toEqual(["1 product", "0 products", "12 products"]));
});
