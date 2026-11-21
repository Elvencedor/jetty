import { isApiError } from "@/lib/api/client";
import { itemAdvice, itemProblem, unavailableItems, type UnavailableItem } from "./unavailable";

/** Where in the checkout the customer should go to put it right. */
export type FailureWhere = "bag" | "delivery" | "payment";

/** Said on every failure: what happened, where to fix it, and (for items) which ones. */
type Detail = { message: string; /** A short heading, when the message needs one. */ title?: string; where?: FailureWhere; items?: UnavailableItem[] };

/** What the checkout screen should do about a failed submission. */
export type CheckoutFailure =
  | ({ kind: "stock" } & Detail)
  | ({ kind: "offer" } & Detail)
  | ({ kind: "delivery" } & Detail)
  | ({ kind: "method" } & Detail)
  /** The order exists but the payment could not start: offer a retry on that order. */
  | { kind: "payment-start"; message: string; orderId: string | undefined }
  | { kind: "busy"; message: string }
  | { kind: "fields"; message: string; fields: Record<string, string> }
  | { kind: "retry"; message: string }
  | { kind: "other"; message: string };

/** What the screen knows that the API does not repeat back, so a message can say where. */
export type FailureContext = { /** The delivery place as typed: "Yaba, Lagos". */ place?: string };

const METHOD_NAME: Record<string, string> = { delivery: "Delivery", pickup: "Pickup", card: "Card", bank_transfer: "Bank transfer" };
const methodName = (m: unknown) => (typeof m === "string" ? (METHOD_NAME[m] ?? m) : undefined);
const detailsOf = (err: { details?: unknown[] | undefined }) => (err.details ?? []).map((d) => (d ?? {}) as Record<string, unknown>);

const orderIdFrom = (details: unknown[] | undefined): string | undefined => {
  const hit = details?.find((d): d is { orderId: string } => typeof (d as { orderId?: unknown })?.orderId === "string");
  return hit?.orderId;
};

/** The server's own explanation of a failure on its side, unless it only gave a generic status ("Internal Server Error"). */
const serverSaid = (err: { code: string; message: string }) =>
  err.code === "INTERNAL_ERROR" || err.code === "REQUEST_FAILED" || !err.message.trim() ? "Something went wrong on our side. Please try again in a moment." : err.message;

/** Maps the API's checkout errors onto plain-language outcomes. */
export function interpretCheckoutError(err: unknown, ctx: FailureContext = {}): CheckoutFailure {
  if (!isApiError(err)) return { kind: "other", message: "Something went wrong. Please try again." };
  switch (err.code) {
    case "OUT_OF_STOCK":
    case "VARIANT_UNAVAILABLE": {
      const items = unavailableItems(err);
      if (items.length === 0) return { kind: "stock", title: "Your bag needs a change", message: "Something in your bag is no longer available in the quantity you chose. Please check your bag.", where: "bag" };
      if (items.length === 1) return { kind: "stock", title: "An item in your bag has changed", message: `${itemProblem(items[0]!)} ${itemAdvice(items[0]!)}`, where: "bag", items };
      return { kind: "stock", title: `${items.length} items in your bag have changed`, message: "Fix each one below, then place your order again.", where: "bag", items };
    }
    case "PROMOTION_UNAVAILABLE": {
      const codes = detailsOf(err).flatMap((d) => (typeof d.code === "string" ? [d.code] : []));
      const what = codes.length ? `The code ${codes.join(", ")} has just run out of uses` : "An offer in your bag has just ended";
      return { kind: "offer", title: "Your total has changed", message: `${what}, so your total has changed. Check your bag, then try again.`, where: "bag" };
    }
    case "DELIVERY_UNAVAILABLE":
      return { kind: "delivery", title: "We can't deliver there yet", message: ctx.place ? `We don't deliver to ${ctx.place} yet. Check the state and area you entered, or use a different address.` : "We don't deliver to that address yet. Check the state and area you entered, or use a different address.", where: "delivery" };
    case "DELIVERY_METHOD_UNAVAILABLE": {
      const method = methodName(detailsOf(err)[0]?.method) ?? "That delivery option";
      return { kind: "delivery", title: `${method} isn't available`, message: `${method} isn't available for ${ctx.place ?? "this address"} right now. Choose another delivery option.`, where: "delivery" };
    }
    case "PAYMENT_METHOD_UNAVAILABLE": {
      const d = detailsOf(err)[0] ?? {};
      const method = methodName(d.method) ?? "That payment method";
      const others = (Array.isArray(d.enabledMethods) ? d.enabledMethods : []).filter((m): m is string => typeof m === "string" && m !== d.method).map((m) => methodName(m)!.toLowerCase());
      return { kind: "method", title: `${method} payments aren't available`, message: `${method} payments aren't available right now.${others.length ? ` You can still pay by ${others.join(" or ")}.` : " Please try again later."}`, where: "payment" };
    }
    case "PAYMENT_INITIALIZATION_FAILED":
    case "PAYMENT_INITIALIZATION_PENDING":
      return { kind: "payment-start", message: "We couldn't start your payment. Your items are still held for you, so you can try again.", orderId: orderIdFrom(err.details) };
    case "PAYOUT_ACCOUNT_NOT_CONFIGURED":
      return { kind: "other", message: "We can't take payments at the moment. Please try again later." };
    case "IDEMPOTENCY_IN_PROGRESS":
      return { kind: "busy", message: "We're already placing this order. Give it a moment." };
    case "VALIDATION_FAILED": {
      const fields: Record<string, string> = {};
      for (const d of err.details ?? []) {
        const { field, message } = (d ?? {}) as { field?: string; message?: string };
        if (field && message) fields[field] = message;
      }
      return { kind: "fields", message: "Please check the details you entered.", fields };
    }
    case "RATE_LIMITED":
      return { kind: "retry", message: `Too many attempts. Try again in ${err.retryAfterSeconds ?? 60} seconds.` };
    default:
      // Only a request that never got an answer is a connection problem. When the server did answer, say what it said.
      if (err.status === 0) return { kind: "retry", message: "We couldn't reach the server. Check your connection and try again." };
      if (err.retryable) return { kind: "retry", message: serverSaid(err) };
      return { kind: "other", message: err.message };
  }
}
