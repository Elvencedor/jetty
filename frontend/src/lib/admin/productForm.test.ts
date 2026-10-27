import { describe, expect, it } from "vitest";
import type { AdminProductDetail } from "@/lib/api/admin-catalog";
import { tidyTags, basicsFrom, changedFields, STATUS_CHOICES, validateBasics } from "./productForm";

const detail = (over: Partial<AdminProductDetail["product"]> = {}): AdminProductDetail => ({
  product: { id: "p", slug: "s", title: "Bone Straight", description: "Soft.", status: "draft", featured: false, badgeOverride: null, tags: [], seoTitle: null, seoDescription: null, details: { details: "100% human hair" }, categoryIds: ["c1", "c2"], collectionIds: [], updatedAt: "2026-01-01T00:00:00Z", ...over },
  options: [], variants: [], media: [],
});

describe("product form", () => {
  it("reads a product into editable text, with blanks for what is missing", () => {
    expect(basicsFrom(detail())).toEqual({ title: "Bone Straight", description: "Soft.", categoryId: "c1", status: "draft", seoTitle: "", seoDescription: "", details: { details: "100% human hair", fit: "", care: "", delivery: "" }, featured: false, badge: "", tags: [] });
  });
  it("sends only what changed, turning blanks back into nulls", () => {
    const was = basicsFrom(detail());
    expect(changedFields(was, was, ["c1", "c2"])).toBeNull();
    expect(changedFields(was, { ...was, title: " New name ", description: "  ", seoTitle: "Buy it", featured: true, badge: "Best seller", tags: [] }, ["c1", "c2"])).toEqual({ title: "New name", description: null, seoTitle: "Buy it", featured: true, badgeOverride: "Best seller" });
    expect(changedFields(was, { ...was, details: { ...was.details, care: "Wash gently" } }, ["c1"])?.details?.care).toBe("Wash gently");
  });
  it("changes the chosen category and keeps any others the product had", () => {
    const was = basicsFrom(detail());
    expect(changedFields(was, { ...was, categoryId: "c3" }, ["c1", "c2"])?.categoryIds).toEqual(["c3", "c2"]);
    expect(changedFields(was, { ...was, categoryId: "" }, ["c1", "c2"])?.categoryIds).toEqual(["c2"]);
  });
  it("offers only the status moves the API has", () => {
    expect(STATUS_CHOICES.draft.map((s) => s.value)).toEqual(["draft", "active"]);
    expect(STATUS_CHOICES.active.map((s) => s.value)).toEqual(["active", "archived"]);
  });
  it("needs a title", () => {
    expect(validateBasics({ ...basicsFrom(detail()), title: "  " }).title).toBeTruthy();
    expect(validateBasics(basicsFrom(detail()))).toEqual({});
  });
});

describe("tags", () => {
  it("tidies tags the way the API stores them", () => {
    expect(tidyTags([" Best  Seller ", "best seller", "Summer", ""])).toEqual(["best seller", "summer"]);
  });
  it("reads tags into the form and sends them only when they changed", () => {
    const was = basicsFrom({ ...detail(), product: { ...detail().product, tags: ["summer"] } });
    expect(was.tags).toEqual(["summer"]);
    expect(changedFields(was, { ...was, tags: ["summer"] }, [])).toBeNull();
    expect(changedFields(was, { ...was, tags: ["summer", " Gift "] }, [])).toEqual({ tags: ["summer", "gift"] });
    expect(changedFields(was, { ...was, tags: [] }, [])).toEqual({ tags: [] });
  });
});
