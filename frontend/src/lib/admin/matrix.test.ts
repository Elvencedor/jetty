import { describe, expect, it } from "vitest";
import type { AdminProductDetail } from "@/lib/api/admin-catalog";
import { addOption, addValue, availableOf, basePrice, computedPrice, deleteValue, editValue, filterVariants, fromDetail, groupVariants, hasCustomPrice, isChanged, keyFromLabel, MAX_VARIANTS, singleVariant, skuFor, skuPrefix, stockLevel, toPayload, totalUnits, unitsWith, updateVariant, variantName, variantsCreatedByAdding, type MatrixDraft } from "./matrix";

const BASE = 14_500_000;
const detail: AdminProductDetail = {
  product: { id: "p1", slug: "bone-straight", title: "Bone Straight Frontal", description: null, status: "active", featured: false, badgeOverride: null, seoTitle: null, seoDescription: null, details: null, categoryIds: [], collectionIds: [], updatedAt: "2026-01-01T00:00:00Z" },
  options: [
    { id: "o1", name: "Length", values: [{ id: "a", label: '12"', valueKey: "12", priceDeltaMinor: 0, swatch: null, active: true }, { id: "b", label: '14"', valueKey: "14", priceDeltaMinor: 1_000_000, swatch: null, active: true }] },
    { id: "o2", name: "Lace", values: [{ id: "c", label: "4×4 closure", valueKey: "4x4-closure", priceDeltaMinor: -2_000_000, swatch: null, active: true }, { id: "d", label: "13×4 HD", valueKey: "13x4-hd", priceDeltaMinor: 0, swatch: null, active: true }] },
    { id: "o3", name: "Colour", values: [{ id: "e", label: "Natural 1B", valueKey: "natural-1b", priceDeltaMinor: 0, swatch: "#1e1612", active: true }] },
  ],
  variants: [
    ["12", "4x4-closure", BASE - 2_000_000, 3], ["12", "13x4-hd", BASE, 0], ["14", "4x4-closure", BASE - 1_000_000, 8], ["14", "13x4-hd", BASE + 1_000_000, 1],
  ].map(([len, lace, price, onHand], i) => ({
    id: `v${i}`, sku: `BS-${len}-${String(lace).toUpperCase()}`, optionValues: { Length: len as string, Lace: lace as string, Colour: "natural-1b" }, priceMinor: price as number, compareAtPriceMinor: null, active: true,
    stock: { onHand: onHand as number, reserved: 0, available: onHand as number, lowStockThreshold: null },
  })),
  media: [],
};
const draft = (): MatrixDraft => fromDetail(detail);

describe("prices", () => {
  it("finds the base the variants agree on, and prices a combination from it", () => {
    expect(basePrice(draft())).toBe(BASE);
    expect(computedPrice(draft(), { Length: "14", Lace: "13x4-hd", Colour: "natural-1b" })).toBe(BASE + 1_000_000);
    expect(computedPrice(draft(), { Length: "12", Lace: "4x4-closure", Colour: "natural-1b" })).toBe(BASE - 2_000_000);
  });
  it("knows a variant with its own price from one priced by its values", () => {
    const d = draft();
    expect(d.variants.some((v) => hasCustomPrice(d, v))).toBe(false);
    const edited = updateVariant(d, 1, { priceMinor: 1 });
    expect(edited.ok && hasCustomPrice(edited.draft, edited.draft.variants[1]!)).toBe(true);
  });
  it("has no base when there are no variants", () => expect(basePrice({ options: [], variants: [] })).toBe(0));
});

describe("adding a value", () => {
  it("creates one variant for every mix of the other options, at the computed price, with no stock, and unique SKUs", () => {
    expect(variantsCreatedByAdding(draft(), "Length")).toBe(2);
    const res = addValue(draft(), "Length", { label: '16"', deltaMinor: 2_000_000 }, "BS");
    if (!res.ok) throw new Error(res.reason);
    expect(res.created).toHaveLength(2);
    expect(res.created!.map((v) => v.priceMinor)).toEqual([BASE + 2_000_000 - 2_000_000, BASE + 2_000_000]);
    expect(res.created!.every((v) => v.onHand === 0 && v.active)).toBe(true);
    expect(new Set(res.draft.variants.map((v) => v.sku)).size).toBe(res.draft.variants.length);
    expect(res.draft.options[0]!.values.at(-1)).toMatchObject({ key: "16", label: '16"', deltaMinor: 2_000_000, active: true });
    expect(res.draft.variants).toHaveLength(6);
  });
  it("refuses a duplicate name (however it is cased), an empty name, and going past the limit", () => {
    expect(addValue(draft(), "Lace", { label: "13x4  hd", deltaMinor: 0 }, "BS")).toMatchObject({ ok: false });
    expect(addValue(draft(), "Lace", { label: "13×4 HD", deltaMinor: 0 }, "BS")).toEqual({ ok: false, reason: "13×4 HD already exists." });
    expect(addValue(draft(), "Lace", { label: "  ", deltaMinor: 0 }, "BS")).toMatchObject({ ok: false });
    const big = draft();
    big.variants = Array.from({ length: MAX_VARIANTS - 1 }, (_, i) => ({ ...big.variants[0]!, sku: `S${i}`, id: `x${i}` }));
    const refused = addValue(big, "Length", { label: '16"', deltaMinor: 0 }, "BS");
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toMatch(/2,000/);
  });
  it("does not offer new variants for a hidden value's mix", () => {
    const hidden = editValue(draft(), "Lace", "4x4-closure", { active: false });
    if (!hidden.ok) throw new Error();
    const res = addValue(hidden.draft, "Length", { label: '16"', deltaMinor: 0 }, "BS");
    if (!res.ok) throw new Error();
    expect(res.created!.map((v) => v.active)).toEqual([false, true]);
  });
});

describe("editing a value", () => {
  it("renames without changing its key, and refuses a name another value has", () => {
    const res = editValue(draft(), "Lace", "13x4-hd", { label: "13×4 HD lace" });
    expect(res.ok && res.draft.options[1]!.values[1]).toMatchObject({ key: "13x4-hd", label: "13×4 HD lace" });
    expect(editValue(draft(), "Lace", "13x4-hd", { label: "4×4 CLOSURE" })).toMatchObject({ ok: false });
    expect(editValue(draft(), "Lace", "13x4-hd", { label: " " })).toMatchObject({ ok: false });
  });
  it("reprices exactly the variants that have the value, by the change", () => {
    const res = editValue(draft(), "Lace", "13x4-hd", { deltaMinor: 2_500_000 });
    if (!res.ok) throw new Error();
    const prices = res.draft.variants.map((v) => v.priceMinor);
    expect(prices).toEqual([BASE - 2_000_000, BASE + 2_500_000, BASE - 1_000_000, BASE + 1_000_000 + 2_500_000]);
    expect(basePrice(res.draft)).toBe(BASE);
  });
  it("keeps a custom price custom when a difference changes", () => {
    const custom = updateVariant(draft(), 0, { priceMinor: 9_900_000 });
    if (!custom.ok) throw new Error();
    const res = editValue(custom.draft, "Lace", "4x4-closure", { deltaMinor: -1_000_000 });
    if (!res.ok) throw new Error();
    expect(res.draft.variants[0]!.priceMinor).toBe(9_900_000 + 1_000_000);
  });
  it("hides a value and the variants that use it, and shows only those with no other hidden value", () => {
    const a = editValue(draft(), "Lace", "4x4-closure", { active: false });
    if (!a.ok) throw new Error();
    expect(a.draft.variants.map((v) => v.active)).toEqual([false, true, false, true]);
    const b = editValue(a.draft, "Length", "12", { active: false });
    if (!b.ok) throw new Error();
    expect(b.draft.variants.map((v) => v.active)).toEqual([false, false, false, true]);
    const c = editValue(b.draft, "Lace", "4x4-closure", { active: true });
    if (!c.ok) throw new Error();
    expect(c.draft.variants.map((v) => v.active)).toEqual([false, false, true, true]);
  });
});

describe("deleting", () => {
  it("removes the value and every variant that uses it, and counts what that costs", () => {
    expect(unitsWith(draft(), "Lace", "4x4-closure")).toBe(11);
    const res = deleteValue(draft(), "Lace", "4x4-closure");
    if (!res.ok) throw new Error();
    expect(res.draft.variants.map((v) => v.sku)).toEqual(["BS-12-13X4-HD", "BS-14-13X4-HD"]);
    expect(res.draft.options[1]!.values).toHaveLength(1);
  });
  it("will not remove the last value of an option", () => {
    expect(deleteValue(draft(), "Colour", "natural-1b")).toMatchObject({ ok: false });
  });
});

describe("adding an option", () => {
  it("gives every variant its one value and leaves prices alone", () => {
    const res = addOption(draft(), "Cap size", { label: "M" });
    if (!res.ok) throw new Error();
    expect(res.draft.options.at(-1)).toMatchObject({ name: "Cap size", values: [{ key: "m", label: "M", deltaMinor: 0 }] });
    expect(res.draft.variants.every((v) => v.values["Cap size"] === "m")).toBe(true);
    expect(res.draft.variants.map((v) => v.priceMinor)).toEqual(draft().variants.map((v) => v.priceMinor));
  });
  it("refuses a duplicate, a blank, and a seventh option", () => {
    expect(addOption(draft(), "lace", { label: "x" })).toMatchObject({ ok: false });
    expect(addOption(draft(), "", { label: "x" })).toMatchObject({ ok: false });
    expect(addOption(draft(), "Z", { label: "" })).toMatchObject({ ok: false });
    let d = draft();
    for (const n of ["A", "B", "C"]) { const r = addOption(d, n, { label: "x" }); if (!r.ok) throw new Error(); d = r.draft; }
    expect(addOption(d, "D", { label: "x" })).toEqual({ ok: false, reason: "A product can have at most 6 options." });
  });
});

describe("variants", () => {
  it("groups by the first option with counts, and filters by the others and by low stock", () => {
    const groups = groupVariants(draft(), { values: {}, lowOnly: false });
    expect(groups.map((g) => [g.value.label, g.all.length, g.units, g.low])).toEqual([['12"', 2, 3, 1], ['14"', 2, 9, 1]]);
    expect(filterVariants(draft(), { values: { Lace: "13x4-hd" }, lowOnly: false })).toHaveLength(2);
    expect(filterVariants(draft(), { values: {}, lowOnly: true }).map((v) => v.sku)).toEqual(["BS-12-13X4-HD", "BS-14-13X4-HD"]);
    expect(groupVariants(draft(), { values: { Lace: "4x4-closure" }, lowOnly: false })[0]!.shown).toHaveLength(1);
  });
  it("names a variant by its other options", () => {
    expect(variantName(draft(), draft().variants[0]!)).toBe("4×4 closure · Natural 1B");
  });
  it("shows sold out, low and fine stock, counting only what is not reserved", () => {
    const [soldOut, low, fine] = [{ ...draft().variants[0]!, onHand: 0 }, { ...draft().variants[0]!, onHand: 1 }, { ...draft().variants[0]!, onHand: 5 }];
    expect([stockLevel(soldOut), stockLevel(low), stockLevel(fine)]).toEqual(["out", "low", "ok"]);
    expect(stockLevel({ ...fine, lowStockThreshold: 6 })).toBe("low");
    expect(availableOf({ ...fine, reserved: 9 })).toBe(0);
    expect(stockLevel({ ...fine, reserved: 5 })).toBe("out");
    expect(totalUnits(draft())).toBe(12);
  });
  it("updates one variant and refuses a SKU another variant has or a blank one", () => {
    const ok = updateVariant(draft(), 0, { sku: "NEW-1", onHand: 9 });
    expect(ok.ok && [ok.draft.variants[0]!.sku, ok.draft.variants[0]!.onHand]).toEqual(["NEW-1", 9]);
    expect(updateVariant(draft(), 0, { sku: "bs-12-13x4-hd" })).toMatchObject({ ok: false });
    expect(updateVariant(draft(), 0, { sku: " " })).toMatchObject({ ok: false });
  });
});

describe("saving", () => {
  it("sends the whole matrix, with stock only for variants that do not exist yet", () => {
    const res = addValue(draft(), "Lace", { label: "Full lace 360", deltaMinor: 4_500_000 }, "BS");
    if (!res.ok) throw new Error();
    const payload = toPayload(res.draft);
    expect(payload.options[1]!.values.at(-1)).toEqual({ label: "Full lace 360", valueKey: "full-lace-360", priceDeltaMinor: 4_500_000, active: true, swatch: null });
    const existing = payload.variants.find((v) => v.id === "v0")!;
    const added = payload.variants.filter((v) => !v.id);
    expect(existing).not.toHaveProperty("stock");
    expect(added).toHaveLength(2);
    expect(added.every((v) => v.stock === 0)).toBe(true);
    expect(payload.variants[0]).toMatchObject({ optionValues: { Length: "12", Lace: "4x4-closure", Colour: "natural-1b" }, compareAtPriceMinor: null, active: true });
  });
  it("tells whether anything changed", () => {
    expect(isChanged(draft(), draft())).toBe(false);
    const res = editValue(draft(), "Lace", "13x4-hd", { label: "x" });
    expect(res.ok && isChanged(draft(), res.draft)).toBe(true);
  });
  it("makes a single variant for a product without options", () => {
    const one = singleVariant("CARE-1", 1_200_000, 10);
    expect(toPayload(one)).toEqual({ options: [], variants: [{ sku: "CARE-1", optionValues: {}, priceMinor: 1_200_000, compareAtPriceMinor: null, active: true, stock: 10 }] });
  });
});

describe("keys and SKUs", () => {
  it("makes safe, unique keys from labels", () => {
    expect(keyFromLabel('14"')).toBe("14");
    expect(keyFromLabel("13×6 HD")).toBe("13x6-hd");
    expect(keyFromLabel("Burgundy 99J!")).toBe("burgundy-99j");
    expect(keyFromLabel("???")).toBe("value");
    expect(keyFromLabel("M", ["m", "m-2"])).toBe("m-3");
  });
  it("makes unique upper-case SKUs and keeps a product's prefix", () => {
    expect(skuFor("bs", ["20", "13x6-hd"], [])).toBe("BS-20-13X6-HD");
    expect(skuFor("BS", ["20"], ["bs-20"])).toBe("BS-20-2");
    expect(skuPrefix(draft(), "Anything")).toBe("BS");
    expect(skuPrefix({ options: [], variants: [] }, "Body Wave Frontal")).toBe("BWF");
    expect(skuPrefix({ options: [], variants: [] }, "!!")).toBe("SKU");
  });
});
