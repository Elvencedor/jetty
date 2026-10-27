import { apiFetch, type RequestOptions } from "./client";
import type { CartItemInput, DeliveryQuote, Quote } from "./types";

type Init = Pick<RequestOptions, "signal">;

/**
 * Server-calculated totals for the bag. Sends the customer's token when there is one so account-only offers (first
 * order, per-customer limits) apply exactly as they will at checkout; a guest simply gets the guest quote. Nothing
 * here is a price lock: checkout recalculates.
 */
export const getQuote = (
  input: { items: CartItemInput[]; promotionCodes: string[]; deliveryAddress?: { state: string; area?: string }; deliveryMethod?: string },
  init: Init = {},
) => apiFetch<Quote>("/pricing/quote", { method: "POST", body: input, auth: "customer", authOptional: true, ...init });

export const getDeliveryQuote = (input: { items: CartItemInput[]; promotionCodes: string[]; deliveryAddress: { state: string; area?: string; city?: string } }, init: Init = {}) =>
  apiFetch<DeliveryQuote>("/delivery/quotes", { method: "POST", body: input, auth: "customer", authOptional: true, ...init });
