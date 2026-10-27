import type { CheckoutStatus } from "@/lib/api/types";

/**
 * Where a payment stands, as far as the shopper is concerned.
 * - `paid`: the order is placed (or further along).
 * - `review`: money arrived but the order needs a person to look at it; reassure, do not retry.
 * - `closed`: cancelled or refunded; nothing more to pay.
 * - `failed`: the latest attempt failed or expired and the order can still be paid.
 * - `waiting`: still being paid or confirmed.
 */
export type PaymentPhase = "paid" | "review" | "closed" | "failed" | "waiting";

export function phaseOf(status: CheckoutStatus, now: number): PaymentPhase {
  if (status.paymentStatus === "paid") return status.status === "payment_exception" ? "review" : "paid";
  if (status.status === "cancelled" || status.status === "refunded") return "closed";
  if (status.reservationExpiresAt && Date.parse(status.reservationExpiresAt) <= now && status.paymentAttempt?.status !== "pending") return "closed";
  const attempt = status.paymentAttempt?.status;
  if (attempt === "failed" || attempt === "expired") return "failed";
  return "waiting";
}

/** Poll quickly while a card payment is being confirmed, slowly while a transfer is awaited. */
export const POLL_CARD_MS = 2000;
export const POLL_TRANSFER_MS = 5000;
export const CONFIRM_WINDOW_MS = 60_000;
