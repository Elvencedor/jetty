import { describe, expect, it } from "vitest";
import type { ProductDetail, Variant } from "@/lib/api/types";
import { choose, firstOpenOption, initialSelection, priceRange, resolveVariant, selectionOf, valuePriceNote, valueState } from "./variants";

const opt = (id: string, values: string[]) => ({ id, name: id, values: values.map((v) => ({ id: v, label: v, valueKey: v, swatch: null })) });
const variant = (id: string, optionValueIds: string[], inStock = true, amount = 100_00): Variant => ({
  id, sku: id, price: { amountMinor: amount, currency: "NGN" }, compareAtPrice: null, optionValueIds,
  availability: { inStock, availableQuantity: inStock ? 5 : 0, lowStock: false },
});

// length 14/20 × lace hd/swiss; 20 × swiss was never made, 14 × swiss is sold out.
const product: Pick<ProductDetail, "options" | "variants" | "defaultVariantId"> = {
  options: [opt("length", ["l14", "l20"]), opt("lace", ["hd", "swiss"])],
  variants: [variant("a", ["l14", "hd"], true, 200_00), variant("b", ["l14", "swiss"], false, 150_00), variant("c", ["l20", "hd"], true, 300_00)],
  defaultVariantId: "c",
};

describe("initialSelection and selectionOf", () => {
  it("starts from the default variant", () => {
    expect(initialSelection(product)).toEqual({ length: "l20", lace: "hd" });
  });
  it("falls back to the first buyable variant when the default is sold out or missing", () => {
    expect(initialSelection({ ...product, defaultVariantId: "b" })).toEqual({ length: "l14", lace: "hd" });
    expect(initialSelection({ ...product, defaultVariantId: null })).toEqual({ length: "l14", lace: "hd" });
  });
  it("uses the first variant when nothing is buyable, and nothing when there are no variants", () => {
    const sold = { ...product, variants: product.variants.map((v) => ({ ...v, availability: { ...v.availability, inStock: false } })), defaultVariantId: null };
    expect(initialSelection(sold)).toEqual({ length: "l14", lace: "hd" });
    expect(initialSelection({ options: [], variants: [], defaultVariantId: null })).toEqual({});
  });
  it("describes a variant as a selection", () => {
    expect(selectionOf(product.variants[1]!, product)).toEqual({ length: "l14", lace: "swiss" });
  });
});

describe("resolveVariant", () => {
  it("finds the variant for a complete selection", () => {
    expect(resolveVariant(product, { length: "l14", lace: "swiss" })?.id).toBe("b");
  });
  it("returns nothing while a choice is missing or the combination does not exist", () => {
    expect(resolveVariant(product, { length: "l14" })).toBeUndefined();
    expect(resolveVariant(product, { length: "l20", lace: "swiss" })).toBeUndefined();
  });
  it("resolves a product without options to its only variant", () => {
    const single = { options: [], variants: [variant("only", [])], defaultVariantId: "only" };
    expect(resolveVariant(single, {})?.id).toBe("only");
  });
});

describe("valueState", () => {
  it("separates sold out from never made, given the other choices", () => {
    expect(valueState(product, { length: "l14" }, "lace", "hd")).toBe("available");
    expect(valueState(product, { length: "l14" }, "lace", "swiss")).toBe("soldOut");
    expect(valueState(product, { length: "l20" }, "lace", "swiss")).toBe("unavailable");
  });
  it("ignores the option's own current choice", () => {
    expect(valueState(product, { length: "l14", lace: "swiss" }, "lace", "hd")).toBe("available");
  });
});

describe("choose", () => {
  it("keeps compatible choices", () => {
    expect(choose(product, { length: "l14", lace: "hd" }, "length", "l20")).toEqual({ length: "l20", lace: "hd" });
  });
  it("drops a conflicting earlier choice instead of leaving an impossible combination", () => {
    expect(choose(product, { length: "l14", lace: "swiss" }, "length", "l20")).toEqual({ length: "l20" });
  });
});

describe("firstOpenOption and priceRange", () => {
  it("finds the next unanswered option", () => {
    expect(firstOpenOption(product, { length: "l14" })).toBe("lace");
    expect(firstOpenOption(product, { length: "l14", lace: "hd" })).toBeUndefined();
  });
  it("gives the lowest and highest price", () => {
    expect(priceRange(product.variants)).toEqual({ min: 150_00, max: 300_00 });
    expect(priceRange([])).toBeNull();
  });
});

describe("valuePriceNote", () => {
  it("shows what each value adds over the cheapest alternative, given the other choices", () => {
    // With 14" chosen: HD lace costs 200_00, Swiss lace 150_00 (cheapest).
    expect(valuePriceNote(product, { length: "l14" }, "lace", "swiss")).toEqual({ extraMinor: 0 });
    expect(valuePriceNote(product, { length: "l14" }, "lace", "hd")).toEqual({ extraMinor: 50_00 });
  });
  it("says nothing when the choices cost the same, or when a value cannot be had", () => {
    const flat = { ...product, variants: product.variants.map((v) => ({ ...v, price: { ...v.price, amountMinor: 100 } })) };
    expect(valuePriceNote(flat, { length: "l14" }, "lace", "hd")).toBeNull();
    expect(valuePriceNote(product, { length: "l20" }, "lace", "swiss")).toBeNull();
  });
});
