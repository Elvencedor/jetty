import type { AdminOrderDetail, AdminOrderRow } from "@/lib/api/admin-orders";
import type { OrderStatusValue } from "@/lib/api/types";
import { formatNaira, lagosDateKey } from "@/lib/format";

export type OrderTab = { key: string; label: string; statuses: OrderStatusValue[] };

/** The filter pills, in the design's order. "Returns" has no counterpart in the API yet, so the last pill gathers the orders that need a decision or are closed. */
export const ORDER_TABS: readonly OrderTab[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "awaiting", label: "Awaiting payment", statuses: ["pending_payment"] },
  { key: "pack", label: "To pack", statuses: ["placed", "packed"] },
  { key: "out", label: "Out for delivery", statuses: ["out_for_delivery"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "closed", label: "Exceptions & closed", statuses: ["payment_exception", "cancelled", "refunded"] },
];

export const tabByKey = (key: string | null) => ORDER_TABS.find((t) => t.key === key) ?? ORDER_TABS[0]!;

/** How many orders a pill holds, from the per-status counts the first page carries. */
export function tabCount(tab: OrderTab, counts: Partial<Record<OrderStatusValue, number>>): number {
  const wanted = tab.statuses.length ? tab.statuses : (Object.keys(counts) as OrderStatusValue[]);
  return wanted.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
}

export const DATE_RANGES = [
  { key: "any", label: "Any time" },
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
] as const;
export type DateRange = (typeof DATE_RANGES)[number]["key"];

const DAY_MS = 86_400_000;

/** The start of a date range as an ISO instant, or undefined for "any time". Days begin at midnight in Lagos (UTC+1, no daylight saving). */
export function rangeStart(range: string | null, now: Date = new Date()): string | undefined {
  if (range === "today") return new Date(`${lagosDateKey(now)}T00:00:00+01:00`).toISOString();
  if (range === "7d") return new Date(now.getTime() - 7 * DAY_MS).toISOString();
  if (range === "30d") return new Date(now.getTime() - 30 * DAY_MS).toISOString();
  return undefined;
}

export const METHOD_LABEL = { card: "Card", bank_transfer: "Bank transfer" } as const;

/** "Same-day · Lekki": how it goes and where. */
export function deliveryLine(row: Pick<AdminOrderRow, "deliveryMethod" | "area" | "state">): string {
  const method = row.deliveryMethod === "pickup" ? "Pickup" : "Delivery";
  const where = row.area ?? row.state;
  return where ? `${method} · ${where}` : method;
}

export const addressLines = (a: AdminOrderDetail["order"]["deliveryAddressSnapshot"]): string =>
  [a.line1, a.line2, a.area, a.city, a.state].filter((part): part is string => !!part && part.trim() !== "").join(", ");

/** wa.me wants digits only. */
export const whatsappLink = (e164: string) => `https://wa.me/${e164.replace(/\D/g, "")}`;

/** "3rd order · ₦612k lifetime". */
export function customerLine(paidOrders: number, lifetimeMinor: number, format: (minor: number) => string): string {
  if (paidOrders === 0) return "No paid orders yet";
  const mod100 = paidOrders % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[paidOrders % 10] ?? "th";
  return `${paidOrders}${suffix} order · ${format(lifetimeMinor)} lifetime`;
}

// ------------------------------------------------------------------- the next step

export type NextStep =
  | { kind: "confirm"; label: string }
  | { kind: "advance"; label: string; to: "packed" | "out_for_delivery" | "delivered"; needsRider: boolean };

/**
 * The one obvious next action for an order, or null when there is none (delivered, cancelled, refunded, or something
 * only a person can untangle). Handing a packed order to a rider needs a rider on file, as the design says; collection
 * orders skip the rider.
 */
export function nextStep(d: Pick<AdminOrderDetail, "order" | "payments" | "delivery" | "allowedTransitions">): NextStep | null {
  const { status, paymentStatus, deliveryMethod } = d.order;
  if (status === "pending_payment" && d.payments.some((p) => p.method === "bank_transfer")) return { kind: "confirm", label: "Confirm transfer received" };
  if (paymentStatus !== "paid") return null;
  const to = d.allowedTransitions[0];
  if (!to || (to !== "packed" && to !== "out_for_delivery" && to !== "delivered")) return null;
  const pickup = deliveryMethod === "pickup";
  const label = to === "packed" ? "Mark as packed" : to === "out_for_delivery" ? "Hand to rider" : pickup ? "Mark as collected" : "Mark as delivered";
  return { kind: "advance", label, to, needsRider: to === "out_for_delivery" };
}

/** Four segments (Paid, Packed, On the way, Delivered) and how many are filled. */
export const PROGRESS_STEPS = ["Paid", "Packed", "On the way", "Delivered"] as const;
export function progressDone(status: OrderStatusValue): number {
  return status === "placed" ? 1 : status === "packed" ? 2 : status === "out_for_delivery" ? 3 : status === "delivered" ? 4 : 0;
}

// ---------------------------------------------------------------------- activity

const EVENT_TEXT: Record<OrderStatusValue, string> = {
  pending_payment: "Order placed, waiting for payment",
  placed: "Payment received",
  packed: "Marked as packed",
  out_for_delivery: "Handed to the rider",
  delivered: "Delivered",
  cancelled: "Order cancelled",
  refunded: "Refunded in full",
  payment_exception: "Payment needs attention",
};

/** Notes the system leaves on the timeline for staff, in words. */
const ANNOTATION: Record<string, string> = {
  PARTIAL_REFUND: "Partly refunded",
  REFUNDED_IN_FULL: "Refunded in full",
  EXTRA_CHARGE_REFUNDED: "Extra charge refunded",
};

export type ActivityEntry = { id: string; at: string; text: string; detail?: string; internal?: boolean };

/** The status history and the internal notes as one list, oldest first. */
export function activity(d: Pick<AdminOrderDetail, "timeline" | "notes">): ActivityEntry[] {
  const events = d.timeline.map((e): ActivityEntry => {
    const annotation = e.note ? ANNOTATION[e.note] : undefined;
    return { id: e.id, at: e.createdAt, text: annotation ?? EVENT_TEXT[e.toStatus], ...(e.note && !annotation ? { detail: e.note } : {}) };
  });
  const notes = d.notes.filter((n) => n.note).map((n): ActivityEntry => ({ id: n.id, at: n.at, text: "Note", detail: n.note!, internal: true }));
  return [...events, ...notes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ------------------------------------------------------------------------ money

/** The totals block: subtotal, the discounts together (named after the promotions), delivery, and what was paid. */
export function totalsRows(order: AdminOrderDetail["order"]): { label: string; value: string; tone?: "discount" | "strong" }[] {
  const names = order.appliedPromotions.map((p) => p.code ?? p.name).filter((n): n is string => !!n);
  return [
    { label: "Subtotal", value: formatNaira(order.subtotalMinor) },
    ...(order.discountMinor > 0 ? [{ label: names.length ? names.join(" + ") : "Discount", value: `−${formatNaira(order.discountMinor)}`, tone: "discount" as const }] : []),
    { label: "Delivery", value: order.deliveryFeeMinor === 0 ? "Free" : formatNaira(order.deliveryFeeMinor) },
    ...(order.taxMinor > 0 ? [{ label: "Tax", value: formatNaira(order.taxMinor) }] : []),
    { label: order.paymentStatus === "paid" ? "Paid" : "Total", value: formatNaira(order.totalMinor), tone: "strong" as const },
  ];
}

/** What can still be refunded across the successful payments (refunds that failed no longer count). */
export function refundable(d: Pick<AdminOrderDetail, "payments" | "refunds">): { remainingMinor: number; attempts: { id: string; remainingMinor: number; label: string }[] } {
  const attempts = d.payments
    .filter((p) => p.status === "succeeded")
    .map((p) => {
      const refunded = d.refunds.filter((r) => r.paymentAttemptId === p.id && r.status !== "failed").reduce((n, r) => n + r.amountMinor, 0);
      return { id: p.id, remainingMinor: p.amountMinor - refunded, label: `${p.method === "card" ? "Card" : "Bank transfer"} · ${formatNaira(p.amountMinor)}` };
    })
    .filter((a) => a.remainingMinor > 0);
  return { remainingMinor: attempts.reduce((n, a) => n + a.remainingMinor, 0), attempts };
}

/** Naira typed by a person ("1,500.50") as kobo, or null when it is not an amount. */
export function parseNairaToMinor(text: string): number | null {
  const cleaned = text.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Phone typed for a rider → E.164, or null. Accepts 0803…, 234803… and +234803…; other international numbers must start with +. */
export function riderPhoneToE164(text: string): string | null {
  const digits = text.replace(/[\s\-().]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  const m = /^(?:0|234)([789]\d{9})$/.exec(digits);
  return m ? `+234${m[1]}` : null;
}
