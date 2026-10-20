import { describe, expect, it } from "vitest";
import type { CheckoutStatus } from "@/lib/api/types";
import { phaseOf } from "./status";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const status = (over: Partial<CheckoutStatus> = {}): CheckoutStatus => ({
  orderId: "o", orderNumber: "JH-1", status: "pending_payment", paymentStatus: "pending", amountMinor: 100, currency: "NGN", reservationExpiresAt: "2026-10-20T12:30:00Z",
  deliveryMethod: "same_day", estimate: null, itemCount: 1, recipientFirstName: null, paymentAttempt: { id: "a", status: "pending" }, ...over,
});

describe("phaseOf", () => {
  it("is paid once the payment is paid, and review when it landed as an exception", () => {
    expect(phaseOf(status({ status: "placed", paymentStatus: "paid" }), NOW)).toBe("paid");
    expect(phaseOf(status({ status: "payment_exception", paymentStatus: "paid" }), NOW)).toBe("review");
  });
  it("is closed for cancelled or refunded orders and for an expired reservation with nothing in flight", () => {
    expect(phaseOf(status({ status: "cancelled" }), NOW)).toBe("closed");
    expect(phaseOf(status({ status: "refunded", paymentStatus: "refunded" }), NOW)).toBe("closed");
    expect(phaseOf(status({ reservationExpiresAt: "2026-10-20T11:00:00Z", paymentAttempt: { id: "a", status: "expired" } }), NOW)).toBe("closed");
  });
  it("keeps waiting for a pending payment even after the reservation clock, since the provider may still settle it", () => {
    expect(phaseOf(status({ reservationExpiresAt: "2026-10-20T11:00:00Z" }), NOW)).toBe("waiting");
  });
  it("is failed when the latest attempt failed or expired but the order can still be paid", () => {
    expect(phaseOf(status({ paymentAttempt: { id: "a", status: "failed" } }), NOW)).toBe("failed");
    expect(phaseOf(status({ paymentAttempt: { id: "a", status: "expired" } }), NOW)).toBe("failed");
  });
  it("is waiting while initializing or pending, or with no attempt yet", () => {
    expect(phaseOf(status({ paymentAttempt: { id: "a", status: "initializing" } }), NOW)).toBe("waiting");
    expect(phaseOf(status({ paymentAttempt: null }), NOW)).toBe("waiting");
  });
});
