import { describe, expect, it } from "vitest";
import type { PromotionRow } from "@/lib/api/admin-promotions";
import { formFromPromotion, announcementText, bagPreview, calendarRows, emptyForm, fromLagosInput, generateCode, normaliseCodeText, sentenceParts, submitLabel, summaryText, toInput, toLagosInput, validateForm, type PromoForm } from "./promotions";

const form = (over: Partial<PromoForm> = {}): PromoForm => ({ ...emptyForm(), name: "Flash sale", ...over });
const collections = [{ id: "c1", name: "Bob wigs", slug: "bob", active: true }, { id: "c2", name: "Frontals", slug: "f", active: true }];

describe("Lagos date fields", () => {
  it("round-trips an instant through a datetime-local value in Lagos time", () => {
    expect(toLagosInput("2026-10-24T23:00:00.000Z")).toBe("2026-10-25T00:00");
    expect(fromLagosInput("2026-10-25T00:00")).toBe("2026-10-24T23:00:00.000Z");
    expect([toLagosInput(null), fromLagosInput(""), fromLagosInput("nope")]).toEqual(["", null, null]);
  });
});

describe("validateForm", () => {
  it("wants a name, and a percentage from 1 to 90", () => {
    expect(validateForm(form({ name: " ", percent: "95" }))).toEqual({ name: "Give it a name your team will recognise", percent: "Enter a percentage from 1 to 90" });
    expect(validateForm(form({ percent: "0" })).percent).toBeDefined();
    expect(validateForm(form({ percent: "15" }))).toEqual({});
  });
  it("wants a positive amount for a fixed discount and whole numbers for buy and get", () => {
    expect(validateForm(form({ kind: "fixed_amount", amount: "" })).amount).toBeDefined();
    expect(validateForm(form({ kind: "fixed_amount", amount: "5,000" }))).toEqual({});
    expect(validateForm(form({ kind: "buy_x_get_y", buy: "0", get: "x" }))).toMatchObject({ buy: "At least 1", get: "At least 1" });
  });
  it("wants a collection when the scope is collections, but never for free delivery", () => {
    expect(validateForm(form({ scope: "collections" })).collections).toBeDefined();
    expect(validateForm(form({ kind: "free_delivery", scope: "collections" }))).toEqual({});
  });
  it("wants a 4 to 20 character code of capitals and numbers", () => {
    expect(validateForm(form({ access: "code", code: "AB" })).code).toBeDefined();
    expect(validateForm(form({ access: "code", code: "FLASH15" }))).toEqual({});
  });
  it("wants the end after the start", () => {
    expect(validateForm(form({ startsAt: "2026-10-25T10:00", endsAt: "2026-10-25T09:00" })).endsAt).toBe("The end has to be after the start");
    expect(validateForm(form({ startsAt: "2026-10-25T10:00", endsAt: "2026-10-26T09:00" }))).toEqual({});
  });
  it("checks the limits and the minimum spend", () => {
    expect(validateForm(form({ minSpend: "abc", totalUses: "0", perCustomer: "x" }))).toMatchObject({ minSpend: expect.any(String), totalUses: expect.any(String), perCustomer: expect.any(String) });
  });
});

describe("toInput", () => {
  it("builds what the API takes for each kind", () => {
    expect(toInput(form({ percent: "15", scope: "collections", collectionIds: ["c1"], minSpend: "50,000", totalUses: "100", perCustomer: "", firstOrderOnly: true, startsAt: "2026-10-25T00:00" }))).toEqual({
      name: "Flash sale", kind: "percentage", configuration: { version: 1, percent: 15 }, scope: { include: { collectionIds: ["c1"] } }, startsAt: "2026-10-24T23:00:00.000Z", endsAt: null, stackable: false, totalUsageLimit: 100, perCustomerLimit: null, firstOrderOnly: true, minimumSubtotalMinor: 5_000_000,
    });
    expect(toInput(form({ kind: "fixed_amount", amount: "5000" })).configuration).toEqual({ version: 1, amountMinor: 500_000 });
    expect(toInput(form({ kind: "buy_x_get_y", buy: "2", get: "1", percentOff: "50" })).configuration).toEqual({ version: 1, buy: 2, get: 1, percentOff: 50 });
    expect(toInput(form({ kind: "free_delivery", scope: "collections", collectionIds: ["c1"] }))).toMatchObject({ configuration: { version: 1 }, scope: {} });
  });
});

describe("scope and zones", () => {
  const lookups = { products: new Map([["p1", "Bone Straight"], ["p2", "Silk Bonnet"]]), zones: new Map([["z1", "Lagos Mainland"], ["z2", "Abuja"]]) };
  it("asks for the products, the zones or the collections the choice needs", () => {
    expect(validateForm(form({ scope: "products" })).products).toBeDefined();
    expect(validateForm(form({ scope: "products", productIds: ["p1"] }))).toEqual({});
    expect(validateForm(form({ scope: "mixed", collectionIds: [], productIds: ["p1"] })).collections).toBeDefined();
    expect(validateForm(form({ kind: "free_delivery", zones: "chosen" })).zones).toBeDefined();
    expect(validateForm(form({ kind: "free_delivery", zones: "chosen", zoneIds: ["z1"] }))).toEqual({});
    expect(validateForm(form({ kind: "free_delivery", zones: "all" }))).toEqual({});
  });
  it("sends products, exclusions and zones to the API", () => {
    expect(toInput(form({ scope: "products", productIds: ["p1"], excludeProductIds: ["p2"] })).scope).toEqual({ include: { productIds: ["p1"] }, excludeProductIds: ["p2"] });
    expect(toInput(form({ scope: "mixed", collectionIds: ["c1"], productIds: ["p1"] })).scope).toEqual({ include: { collectionIds: ["c1"], productIds: ["p1"] } });
    expect(toInput(form({ scope: "all", excludeProductIds: ["p2"] })).scope).toEqual({ excludeProductIds: ["p2"] });
    expect(toInput(form({ kind: "free_delivery", zones: "chosen", zoneIds: ["z1", "z2"], excludeProductIds: ["p2"] }))).toMatchObject({ configuration: { version: 1, zoneIds: ["z1", "z2"] }, scope: {} });
    expect(toInput(form({ kind: "free_delivery" })).configuration).toEqual({ version: 1 });
  });
  it("reads them back, keeping a promotion that had both collections and products as it was", () => {
    const detail = (scope: object, configuration: object = { version: 1, percent: 10 }) => ({ promotion: { name: "P", kind: "percentage", configuration, scope, usageCount: 0, startsAt: null, endsAt: null, stackable: false, totalUsageLimit: null, perCustomerLimit: null, firstOrderOnly: false, minimumSubtotalMinor: null }, codes: [], stats: {} }) as never;
    expect(formFromPromotion(detail({ include: { productIds: ["p1"] }, excludeProductIds: ["p2"] }))).toMatchObject({ scope: "products", productIds: ["p1"], excludeProductIds: ["p2"] });
    expect(formFromPromotion(detail({ include: { collectionIds: ["c1"], productIds: ["p1"] } })).scope).toBe("mixed");
    expect(formFromPromotion(detail({}, { version: 1, zoneIds: ["z1"] }))).toMatchObject({ zones: "chosen", zoneIds: ["z1"] });
  });
  it("reads them out loud", () => {
    const read = (f: PromoForm) => sentenceParts(f, collections, lookups).map((p) => p.text).join("");
    expect(read(form({ scope: "products", productIds: ["p1", "p2"] }))).toBe("Take 10% off Bone Straight and Silk Bonnet.");
    expect(read(form({ excludeProductIds: ["p2"] }))).toBe("Take 10% off all products except Silk Bonnet.");
    expect(read(form({ kind: "free_delivery", zones: "chosen", zoneIds: ["z1", "z2"] }))).toBe("Delivery is free to Lagos Mainland and Abuja.");
    expect(announcementText(form({ kind: "free_delivery", zones: "chosen", zoneIds: ["z2"] }), collections, lookups)).toBe("Free delivery to Abuja");
    expect(announcementText(form({ scope: "products", productIds: ["p1"] }), collections, lookups)).toBe("10% off on Bone Straight");
  });
});

describe("free gifts", () => {
  const gift = (over: Partial<PromoForm> = {}) => form({ kind: "free_gift", giftVariantId: "v1", giftQuantity: "1", giftLabel: "Silk Bonnet (Champagne)", giftPriceMinor: 2_000_000, ...over });
  it("needs a gift and a sensible number of them", () => {
    expect(validateForm(form({ kind: "free_gift" })).gift).toBeDefined();
    expect(validateForm(gift())).toEqual({});
    expect(validateForm(gift({ giftQuantity: "0" })).giftQuantity).toBeDefined();
    expect(validateForm(gift({ giftQuantity: "11" })).giftQuantity).toBeDefined();
    expect(validateForm(gift({ giftQuantity: "x" })).giftQuantity).toBeDefined();
  });
  it("sends the variant and quantity, with the scope that triggers it", () => {
    expect(toInput(gift({ giftQuantity: "2", scope: "collections", collectionIds: ["c1"] }))).toMatchObject({ kind: "free_gift", configuration: { version: 1, variantId: "v1", quantity: 2 }, scope: { include: { collectionIds: ["c1"] } } });
  });
  it("reads it back, and previews it as free", () => {
    expect(sentenceParts(gift({ giftQuantity: "2" }), collections).map((p) => p.text).join("")).toBe("Give 2 free Silk Bonnet (Champagne) when someone buys all products.");
    expect(announcementText(gift(), collections)).toBe("Free Silk Bonnet (Champagne) with your order");
    expect(bagPreview(gift())).toEqual({ quantity: 1, subtotal: "₦150,000", discount: { label: "Free gift: Silk Bonnet (Champagne)", value: "Free" }, total: "₦150,000" });
  });
  it("reads a saved gift back into the form", () => {
    const d = { promotion: { name: "G", kind: "free_gift", configuration: { version: 1, variantId: "v1", quantity: 2 }, scope: {}, usageCount: 0, startsAt: null, endsAt: null, stackable: false, totalUsageLimit: null, perCustomerLimit: null, firstOrderOnly: false, minimumSubtotalMinor: null }, gift: { variantId: "v1", productId: "p", productTitle: "Silk Bonnet", sku: "SB", optionSummary: "Champagne", priceMinor: 2_000_000, quantity: 2 }, codes: [], stats: {} } as never;
    expect(formFromPromotion(d)).toMatchObject({ kind: "free_gift", giftVariantId: "v1", giftQuantity: "2", giftLabel: "Silk Bonnet (Champagne)", giftPriceMinor: 2_000_000 });
  });
});

describe("the rule in words", () => {
  it("reads each kind back", () => {
    const read = (f: PromoForm) => sentenceParts(f, collections).map((p) => p.text).join("");
    expect(read(form({ percent: "15" }))).toBe("Take 15% off all products.");
    expect(read(form({ kind: "fixed_amount", amount: "5000", scope: "collections", collectionIds: ["c1", "c2"] }))).toBe("Take ₦5000 off products in Bob wigs and Frontals.");
    expect(read(form({ kind: "buy_x_get_y", scope: "collections", collectionIds: ["c1"] }))).toBe("Buy 1 from products in Bob wigs, get 1 free (the cheaper ones).");
    expect(read(form({ kind: "buy_x_get_y", percentOff: "50" }))).toBe("Buy 1 from all products, get 1 at 50% off.");
    expect(read(form({ kind: "free_delivery" }))).toBe("Delivery is free on the order.");
  });
  it("writes the announcement bar, with the code when there is one", () => {
    expect(announcementText(form({ percent: "15", scope: "collections", collectionIds: ["c2"], access: "code", code: "FLASH15" }), collections)).toBe("15% off on Frontals with code FLASH15");
    expect(announcementText(form({ kind: "free_delivery" }), collections)).toBe("Free delivery");
  });
});

describe("bagPreview", () => {
  it("shows the discount on a sample item", () => {
    expect(bagPreview(form({ percent: "20" }))).toEqual({ quantity: 1, subtotal: "₦150,000", discount: { label: "Discount", value: "−₦30,000" }, total: "₦120,000" });
    expect(bagPreview(form({ kind: "fixed_amount", amount: "5000" })).total).toBe("₦145,000");
    expect(bagPreview(form({ kind: "buy_x_get_y" }))).toMatchObject({ quantity: 2, subtotal: "₦300,000", total: "₦150,000" });
    expect(bagPreview(form({ kind: "free_delivery" })).discount).toEqual({ label: "Delivery", value: "Free" });
  });
});

describe("codes and labels", () => {
  it("cleans a typed code and generates 8 safe characters", () => {
    expect(normaliseCodeText("flash-15 sale!")).toBe("FLASH15SALE");
    expect(generateCode(() => 0)).toBe("AAAAAAAA");
    expect(generateCode()).toMatch(/^[A-Z2-9]{8}$/);
  });
  it("says what the last button does", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    expect(submitLabel(form(), false, now)).toBe("Start now");
    expect(submitLabel(form({ startsAt: "2026-10-30T00:00" }), false, now)).toBe("Schedule promotion");
    expect(submitLabel(form({ startsAt: "2026-10-30T00:00" }), true, now)).toBe("Save changes");
  });
});

describe("list and calendar", () => {
  const row = (over: Partial<PromotionRow>): PromotionRow => ({ id: "a", name: "A", kind: "percentage", status: "live", startsAt: null, endsAt: null, priority: 0, stackable: false, type: "automatic", usage: { redemptions: 0, openHolds: 0, limit: null }, createdAt: null, ...over });
  it("counts by status", () => {
    expect(summaryText([row({}), row({ status: "live" }), row({ status: "scheduled" }), row({ status: "ended" }), row({ status: "draft" })])).toBe("2 live · 1 scheduled · 1 ended · 1 not running");
  });
  it("places a promotion on the days of the month it covers, clipped to the month", () => {
    const rows = [
      row({ id: "in", name: "In", startsAt: "2026-10-09T23:00:00Z", endsAt: "2026-10-14T22:00:00Z" }),
      row({ id: "out", name: "Out", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-10T00:00:00Z" }),
      row({ id: "long", name: "Long", startsAt: "2026-09-20T00:00:00Z", endsAt: "2026-11-20T00:00:00Z", type: "code" }),
      row({ id: "undated", name: "Undated" }),
    ];
    expect(calendarRows(rows, 2026, 10).map((c) => [c.id, c.from, c.to, c.label])).toEqual([["long", 1, 31, "Code"], ["in", 10, 14, "Auto"]]);
  });
});
