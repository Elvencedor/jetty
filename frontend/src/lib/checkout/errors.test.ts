import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { interpretCheckoutError } from "./errors";

const api = (status: number, code: string, details?: unknown[]) => new ApiError(status, { code, message: "server says", requestId: "r", ...(details ? { details } : {}) });
const item = (n: number, over: Record<string, unknown> = {}) => ({ variantId: `v${n}`, productTitle: `Wig ${n}`, optionSummary: '20" · HD', reason: "NOT_FOR_SALE", ...over });

describe("a failed order says what went wrong and where to fix it", () => {
  describe("items", () => {
    it("names the one item that is no longer available, and what to do", () => {
      const f = interpretCheckoutError(api(422, "VARIANT_UNAVAILABLE", [item(1)]));
      expect(f).toMatchObject({ kind: "stock", where: "bag", title: "An item in your bag has changed", message: 'Wig 1 (20" · HD) is no longer available. Remove it from your bag to continue.' });
    });

    it("lists several, each by name", () => {
      const f = interpretCheckoutError(api(422, "VARIANT_UNAVAILABLE", [item(1), item(2, { reason: "REMOVED", productTitle: null })]));
      expect(f).toMatchObject({ kind: "stock", where: "bag", title: "2 items in your bag have changed" });
      expect("items" in f && f.items?.map((i) => i.name)).toEqual(["Wig 1", null]);
    });

    it("says how many are left when there is not enough, or that it sold out", () => {
      expect(interpretCheckoutError(api(409, "OUT_OF_STOCK", [{ variantId: "v1", productTitle: "Wig 1", optionSummary: "", requestedQuantity: 3, availableQuantity: 1 }])).message).toBe("Only 1 of Wig 1 is left, and you asked for 3. Lower the quantity in your bag.");
      expect(interpretCheckoutError(api(409, "OUT_OF_STOCK", [{ variantId: "v1", productTitle: "Wig 1", optionSummary: "", requestedQuantity: 1, availableQuantity: 0 }])).message).toBe("Wig 1 has just sold out. Remove it from your bag to continue.");
    });

    it("still says something useful when the API names nothing", () => {
      expect(interpretCheckoutError(api(409, "OUT_OF_STOCK"))).toMatchObject({ kind: "stock", where: "bag", message: expect.stringContaining("check your bag") });
    });
  });

  describe("offers", () => {
    it("names the code that ran out", () => {
      expect(interpretCheckoutError(api(409, "PROMOTION_UNAVAILABLE", [{ promotionId: "p", code: "SAVE10" }])).message).toBe("The code SAVE10 has just run out of uses, so your total has changed. Check your bag, then try again.");
    });
    it("says an automatic offer ended when there is no code", () => {
      expect(interpretCheckoutError(api(409, "PROMOTION_UNAVAILABLE", [{ promotionId: "p", code: null }])).message).toMatch(/^An offer in your bag has just ended/);
    });
  });

  describe("delivery", () => {
    it("names the place that is not served, and sends the customer to the delivery step", () => {
      expect(interpretCheckoutError(api(422, "DELIVERY_UNAVAILABLE"), { place: "Bonny, Rivers" })).toMatchObject({ kind: "delivery", where: "delivery", message: expect.stringContaining("We don't deliver to Bonny, Rivers yet.") });
    });
    it("still works without a place", () => {
      expect(interpretCheckoutError(api(422, "DELIVERY_UNAVAILABLE")).message).toMatch(/^We don't deliver to that address yet/);
    });
    it("names the option that is not available for the place", () => {
      expect(interpretCheckoutError(api(422, "DELIVERY_METHOD_UNAVAILABLE", [{ method: "pickup", reason: "NOT_OFFERED" }]), { place: "Yaba, Lagos" })).toMatchObject({ title: "Pickup isn't available", message: "Pickup isn't available for Yaba, Lagos right now. Choose another delivery option." });
    });
  });

  describe("payment", () => {
    it("names the method and offers the ones that still work", () => {
      expect(interpretCheckoutError(api(422, "PAYMENT_METHOD_UNAVAILABLE", [{ method: "card", enabledMethods: ["bank_transfer"] }]))).toMatchObject({ kind: "method", where: "payment", message: "Card payments aren't available right now. You can still pay by bank transfer." });
    });
    it("says to try later when nothing else is on", () => {
      expect(interpretCheckoutError(api(422, "PAYMENT_METHOD_UNAVAILABLE", [{ method: "card", enabledMethods: ["card"] }])).message).toBe("Card payments aren't available right now. Please try again later.");
    });
  });
});

describe("a failure on the server's side", () => {
  it("says what the server said when it gave a reason, instead of blaming the connection", () => {
    const f = interpretCheckoutError(new ApiError(503, { code: "PAYMENTS_UNAVAILABLE", message: "Payments are temporarily unavailable.", requestId: "r" }));
    expect(f).toEqual({ kind: "retry", message: "Payments are temporarily unavailable." });
  });
  it("keeps the connection message for a request that got no answer at all", () => {
    expect(interpretCheckoutError(new ApiError(0, { code: "NETWORK_ERROR", message: "x", requestId: "r" }))).toEqual({ kind: "retry", message: "We couldn't reach the server. Check your connection and try again." });
  });
  it("does not show a bare status text; it says something went wrong on our side", () => {
    expect(interpretCheckoutError(new ApiError(500, { code: "INTERNAL_ERROR", message: "Internal Server Error", requestId: "r" }))).toEqual({ kind: "retry", message: "Something went wrong on our side. Please try again in a moment." });
  });
});

