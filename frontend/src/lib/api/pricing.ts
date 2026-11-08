import { apiFetch, isApiError, type RequestOptions } from "./client";
import type { CartItemInput, DeliveryQuote, Quote } from "./types";

type Init = Pick<RequestOptions, "signal">;

/** The server answered, and the answer is that no delivery zone covers this place: not a connection problem. */
export const isDeliveryUnavailable = (err: unknown) => isApiError(err) && err.code === "DELIVERY_UNAVAILABLE";

/**
 * Server-calculated totals for the bag. Sends the customer's token when there is one so account-only offers (first
 * order, per-customer limits) apply exactly as they will at checkout; a guest simply gets the guest quote. Nothing
 * here is a price lock: checkout recalculates.
 */
export const getQuote = (
  input: { items: CartItemInput[]; promotionCodes: string[]; deliveryAddress?: { state: string; area?: string }; deliveryMethod?: string; paymentMethod?: string },
  init: Init = {},
) => apiFetch<Quote>("/pricing/quote", { method: "POST", body: input, auth: "customer", authOptional: true, ...init });

export const getDeliveryQuote = (input: { items: CartItemInput[]; promotionCodes: string[]; deliveryAddress: { state: string; area?: string; city?: string } }, init: Init = {}) =>
  apiFetch<DeliveryQuote>("/delivery/quotes", { method: "POST", body: input, auth: "customer", authOptional: true, ...init });
