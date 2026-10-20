import { describe, expect, it } from "vitest";
import type { Quote, QuoteLine } from "@/lib/api/types";
import { buildLineViews, canCheckout, rejectionMessage, unitCount } from "./model";

const priced = (variantId: string, quantity = 1): QuoteLine => ({
  variantId, productId: "p", slug: "s", title: "T", image: null, options: [], optionSummary: "", compareAtPriceMinor: null, availableQuantity: 9, quantity,
  unitPriceMinor: 100, lineSubtotalMinor: 100 * quantity, discountMinor: 0, lineTotalMinor: 100 * quantity, promotionAllocations: [],
});
const quote = (over: Partial<Quote> = {}): Quote => ({
  currency: "NGN", lines: [], promotions: { applied: [], rejectedCodes: [] }, warnings: [], subtotalMinor: 0, discountMinor: 0, delivery: null, deliveryFeeMinor: 0, taxMinor: 0, totalMinor: 0, quoteId: "q", quoteExpiresAt: "2099-01-01T00:00:00Z", ...over,
});

describe("buildLineViews", () => {
  it("shows the bag as it is before any quote", () => {
    expect(buildLineViews([{ variantId: "a", quantity: 2 }], undefined)).toEqual([{ variantId: "a", quantity: 2 }]);
  });

  it("matches priced lines and marks a variant the quote dropped as gone", () => {
    const views = buildLineViews([{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 1 }], quote({ lines: [priced("a")] }));
    expect(views[0]).toMatchObject({ variantId: "a", priced: { variantId: "a" } });
    expect(views[0]!.problem).toBeUndefined();
    expect(views[1]).toEqual({ variantId: "b", quantity: 1, problem: { kind: "gone" } });
  });

  it("reads stock warnings: some left is short, none left is gone", () => {
    const warnings: Quote["warnings"] = [
      { code: "INSUFFICIENT_STOCK", variantId: "a", requestedQuantity: 5, availableQuantity: 2 },
      { code: "OUT_OF_STOCK", variantId: "b", requestedQuantity: 1, availableQuantity: 0 },
    ];
    const views = buildLineViews([{ variantId: "a", quantity: 5 }, { variantId: "b", quantity: 1 }], quote({ lines: [priced("a", 5), priced("b")], warnings }));
    expect(views[0]!.problem).toEqual({ kind: "short", available: 2 });
    expect(views[1]!.problem).toEqual({ kind: "gone" });
  });

  it("ignores warnings that are not about stock", () => {
    const views = buildLineViews([{ variantId: "a", quantity: 1 }], quote({ lines: [priced("a")], warnings: [{ code: "SIGN_IN_FOR_OFFERS" }] }));
    expect(views[0]!.problem).toBeUndefined();
  });
});

describe("canCheckout", () => {
  const ok = buildLineViews([{ variantId: "a", quantity: 1 }], quote({ lines: [priced("a")] }));
  it("needs a settled quote, a non-empty bag and no problems", () => {
    expect(canCheckout(ok, quote(), false)).toBe(true);
    expect(canCheckout(ok, quote(), true)).toBe(false);
    expect(canCheckout(ok, undefined, false)).toBe(false);
    expect(canCheckout([], quote(), false)).toBe(false);
    expect(canCheckout([{ variantId: "a", quantity: 1, problem: { kind: "gone" } }], quote(), false)).toBe(false);
  });
});

describe("messages and counts", () => {
  it("has a message for every rejection reason, including a sign-in nudge", () => {
    expect(rejectionMessage("NOT_ELIGIBLE")).toBe("Sign in to use this offer.");
    expect(rejectionMessage("EXPIRED")).toMatch(/expired/);
    expect(rejectionMessage("SOMETHING_NEW" as never)).toBe("That code can't be used.");
  });
  it("counts units", () => {
    expect(unitCount([{ variantId: "a", quantity: 2 }, { variantId: "b", quantity: 3 }])).toBe(5);
  });
});
