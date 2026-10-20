import { isApiError } from "@/lib/api/client";

/** What the checkout screen should do about a failed submission. */
export type CheckoutFailure =
  | { kind: "stock"; message: string }
  | { kind: "offer"; message: string }
  | { kind: "delivery"; message: string }
  | { kind: "method"; message: string }
  /** The order exists but the payment could not start: offer a retry on that order. */
  | { kind: "payment-start"; message: string; orderId: string | undefined }
  | { kind: "busy"; message: string }
  | { kind: "fields"; message: string; fields: Record<string, string> }
  | { kind: "retry"; message: string }
  | { kind: "other"; message: string };

const orderIdFrom = (details: unknown[] | undefined): string | undefined => {
  const hit = details?.find((d): d is { orderId: string } => typeof (d as { orderId?: unknown })?.orderId === "string");
  return hit?.orderId;
};

/** Maps the API's checkout errors onto plain-language outcomes. */
export function interpretCheckoutError(err: unknown): CheckoutFailure {
  if (!isApiError(err)) return { kind: "other", message: "Something went wrong. Please try again." };
  switch (err.code) {
    case "OUT_OF_STOCK":
    case "VARIANT_UNAVAILABLE":
      return { kind: "stock", message: "Some items are no longer available in the quantity you chose. We've refreshed your bag." };
    case "PROMOTION_UNAVAILABLE":
      return { kind: "offer", message: "An offer in your bag is no longer available, so your total has changed. Please check your bag." };
    case "DELIVERY_UNAVAILABLE":
    case "DELIVERY_METHOD_UNAVAILABLE":
      return { kind: "delivery", message: "We can't deliver that way to this address. Please choose another delivery option." };
    case "PAYMENT_METHOD_UNAVAILABLE":
      return { kind: "method", message: "That payment method isn't available right now. Please choose another." };
    case "PAYMENT_INITIALIZATION_FAILED":
    case "PAYMENT_INITIALIZATION_PENDING":
      return { kind: "payment-start", message: "We couldn't start your payment. Your items are still held for you, so you can try again.", orderId: orderIdFrom(err.details) };
    case "IDEMPOTENCY_IN_PROGRESS":
      return { kind: "busy", message: "We're already placing this order. Give it a moment." };
    case "VALIDATION_FAILED": {
      const fields: Record<string, string> = {};
      for (const d of err.details ?? []) {
        const { field, message } = d as { field?: string; message?: string };
        if (field && message) fields[field] = message;
      }
      return { kind: "fields", message: "Please check the details you entered.", fields };
    }
    case "RATE_LIMITED":
      return { kind: "retry", message: `Too many attempts. Try again in ${err.retryAfterSeconds ?? 60} seconds.` };
    default:
      return err.retryable ? { kind: "retry", message: "We couldn't reach the server. Check your connection and try again." } : { kind: "other", message: err.message };
  }
}
