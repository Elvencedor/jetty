import { describe, expect, it } from "vitest";
import type { AdminOrderDetail } from "@/lib/api/admin-orders";
import { activity, customerLine, nextStep, ORDER_TABS, parseNairaToMinor, progressDone, rangeStart, refundable, riderPhoneToE164, tabCount, totalsRows, whatsappLink } from "./orders";

type D = Parameters<typeof nextStep>[0];
const detail = (over: { status?: string; paymentStatus?: string; deliveryMethod?: string; method?: "card" | "bank_transfer"; allowed?: string[] } = {}): D =>
  ({
    order: { status: over.status ?? "placed", paymentStatus: over.paymentStatus ?? "paid", deliveryMethod: over.deliveryMethod ?? "delivery" },
    payments: [{ method: over.method ?? "card" }],
    delivery: null,
    allowedTransitions: over.allowed ?? [],
  }) as unknown as D;

describe("tabs", () => {
  it("counts each pill from the per-status counts, and All is everything", () => {
    const counts = { placed: 3, packed: 2, pending_payment: 1, delivered: 7, cancelled: 1 };
    const by = (key: string) => tabCount(ORDER_TABS.find((t) => t.key === key)!, counts);
    expect(by("pack")).toBe(5);
    expect(by("awaiting")).toBe(1);
    expect(by("closed")).toBe(1);
    expect(by("all")).toBe(14);
  });
});

describe("rangeStart", () => {
  const now = new Date("2026-10-20T23:30:00Z"); // 00:30 on the 21st in Lagos
  it("starts today at midnight Lagos time", () => expect(rangeStart("today", now)).toBe("2026-10-20T23:00:00.000Z"));
  it("counts back whole days", () => expect(rangeStart("7d", now)).toBe("2026-10-13T23:30:00.000Z"));
  it("has no start for any time", () => expect(rangeStart(null, now)).toBeUndefined());
});

describe("nextStep", () => {
  it("confirms an unpaid transfer, and offers nothing for an unpaid card order", () => {
    expect(nextStep(detail({ status: "pending_payment", paymentStatus: "pending", method: "bank_transfer" }))).toEqual({ kind: "confirm", label: "Confirm transfer received" });
    expect(nextStep(detail({ status: "pending_payment", paymentStatus: "pending" }))).toBeNull();
  });
  it("labels each fulfilment step, and a rider is needed only to hand over", () => {
    expect(nextStep(detail({ allowed: ["packed"] }))).toEqual({ kind: "advance", label: "Mark as packed", to: "packed", needsRider: false });
    expect(nextStep(detail({ status: "packed", allowed: ["out_for_delivery"] }))).toMatchObject({ label: "Hand to rider", needsRider: true });
    expect(nextStep(detail({ status: "out_for_delivery", allowed: ["delivered"] }))).toMatchObject({ label: "Mark as delivered", needsRider: false });
  });
  it("calls the last step of a collection order collected", () => {
    expect(nextStep(detail({ status: "packed", deliveryMethod: "pickup", allowed: ["delivered"] }))).toMatchObject({ label: "Mark as collected", to: "delivered" });
  });
  it("has nothing to do once an order is finished", () => expect(nextStep(detail({ status: "delivered" }))).toBeNull());
});

describe("progress", () => {
  it("fills Paid, Packed, On the way, Delivered in turn", () => {
    expect(["pending_payment", "placed", "packed", "out_for_delivery", "delivered", "cancelled"].map((s) => progressDone(s as never))).toEqual([0, 1, 2, 3, 4, 0]);
  });
});

describe("activity", () => {
  it("merges status changes and notes in time order, in words", () => {
    const log = activity({
      timeline: [
        { id: "a", fromStatus: null, toStatus: "pending_payment", actorType: "customer", actorId: null, note: null, createdAt: "2026-10-20T09:00:00Z" },
        { id: "b", fromStatus: "placed", toStatus: "placed", actorType: "admin", actorId: "x", note: "PARTIAL_REFUND", createdAt: "2026-10-20T11:00:00Z" },
      ],
      notes: [{ id: "n", at: "2026-10-20T10:00:00Z", adminUserId: "x", note: "Call first" }],
    } as AdminOrderDetail);
    expect(log.map((l) => [l.text, l.detail, l.internal])).toEqual([
      ["Order placed, waiting for payment", undefined, undefined],
      ["Note", "Call first", true],
      ["Partly refunded", undefined, undefined],
    ]);
  });
});

describe("money", () => {
  const order = { subtotalMinor: 36_550_000, discountMinor: 11_445_000, deliveryFeeMinor: 0, taxMinor: 0, totalMinor: 25_105_000, paymentStatus: "paid", appliedPromotions: [{ code: "FLASH15" }, { name: "BOGO" }] } as AdminOrderDetail["order"];
  it("shows combined discounts by name in the totals", () => {
    expect(totalsRows(order)).toEqual([
      { label: "Subtotal", value: "₦365,500" },
      { label: "FLASH15 + BOGO", value: "−₦114,450", tone: "discount" },
      { label: "Delivery", value: "Free" },
      { label: "Paid", value: "₦251,050", tone: "strong" },
    ]);
  });
  it("works out what is left to refund per successful payment, ignoring failed refunds", () => {
    const left = refundable({
      payments: [{ id: "p1", method: "card", status: "succeeded", amountMinor: 1_000_000 }, { id: "p2", method: "card", status: "failed", amountMinor: 500_000 }],
      refunds: [{ paymentAttemptId: "p1", amountMinor: 300_000, status: "processing" }, { paymentAttemptId: "p1", amountMinor: 200_000, status: "failed" }],
    } as AdminOrderDetail);
    expect(left.remainingMinor).toBe(700_000);
    expect(left.attempts).toHaveLength(1);
  });
  it("reads typed naira", () => {
    expect([parseNairaToMinor("5,000"), parseNairaToMinor("₦1,500.50"), parseNairaToMinor("12.345"), parseNairaToMinor("abc"), parseNairaToMinor("")]).toEqual([500_000, 150_050, null, null, null]);
  });
});

describe("contact details", () => {
  it("builds a WhatsApp link from digits only", () => expect(whatsappLink("+2348031234567")).toBe("https://wa.me/2348031234567"));
  it("turns a typed rider number into E.164", () => {
    expect([riderPhoneToE164("0803 123 4567"), riderPhoneToE164("2348031234567"), riderPhoneToE164("+14155550123"), riderPhoneToE164("12345")]).toEqual(["+2348031234567", "+2348031234567", "+14155550123", null]);
  });
  it("describes the customer's history", () => {
    const k = (n: number) => `₦${n / 100000}k`;
    expect([customerLine(0, 0, k), customerLine(1, 100_000, k), customerLine(3, 61_200_000, k), customerLine(12, 100_000, k), customerLine(21, 100_000, k)]).toEqual([
      "No paid orders yet", "1st order · ₦1k lifetime", "3rd order · ₦612k lifetime", "12th order · ₦1k lifetime", "21st order · ₦1k lifetime",
    ]);
  });
});
