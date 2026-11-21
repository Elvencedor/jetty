import { describe, expect, it } from "vitest";
import { fromDetail } from "./matrix";
import { basicsFrom } from "./productForm";
import { overlapWithRemote } from "./rebase";
import type { AdminProductDetail } from "@/lib/api/admin-catalog";

const detail = (over: Record<string, unknown> = {}): AdminProductDetail =>
  ({ product: { id: "p", title: "Wig", description: null, status: "draft", featured: false, categoryIds: [], collectionIds: [], tags: [], details: {}, badgeOverride: null, seoTitle: null, seoDescription: null, updatedAt: "", version: 1, ...over }, options: [], variants: [], media: [] }) as unknown as AdminProductDetail;

const base = (d: AdminProductDetail) => ({ basics: basicsFrom(d), matrix: fromDetail(d), categoryIds: d.product.categoryIds });

describe("overlapWithRemote", () => {
  it("is empty when the other change touched something else", () => {
    const opened = detail();
    const fresh = detail({ featured: true, version: 2 });
    expect(overlapWithRemote({ base: base(opened), mine: { fields: { title: "New" }, matrixChanged: false, status: "draft" }, fresh })).toEqual([]);
  });
  it("names what both people changed", () => {
    const opened = detail();
    const fresh = detail({ title: "Theirs", tags: ["sale"], version: 2 });
    expect(overlapWithRemote({ base: base(opened), mine: { fields: { title: "Mine", featured: true }, matrixChanged: false, status: "draft" }, fresh })).toEqual(["the name"]);
  });
  it("sees a status that was moved two different ways", () => {
    const opened = detail();
    const fresh = detail({ status: "archived", version: 2 });
    expect(overlapWithRemote({ base: base(opened), mine: { fields: null, matrixChanged: false, status: "active" }, fresh })).toEqual(["the status"]);
    expect(overlapWithRemote({ base: base(opened), mine: { fields: null, matrixChanged: false, status: "archived" }, fresh })).toEqual([]);
  });
});
