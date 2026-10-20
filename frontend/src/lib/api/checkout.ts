import { apiFetch, type RequestOptions } from "./client";
import type { CheckoutRequest, CheckoutResponse, CheckoutStatus, PaymentStart, TrackResult } from "./types";

type Init = Pick<RequestOptions, "signal">;

/**
 * Creates the order and starts payment. `idempotencyKey` must be a random UUID (32+ characters for guests) and the
 * same key must be reused for every retry of the same submission. The guest checkout cookie is set by the API.
 */
export const placeOrder = (body: CheckoutRequest, idempotencyKey: string, init: Init = {}) =>
  apiFetch<CheckoutResponse>("/checkout", { method: "POST", body, idempotencyKey, auth: "customer", authOptional: true, ...init });

/** A new payment attempt for an unpaid order whose previous attempt definitively failed or expired. */
export const retryPayment = (orderId: string, idempotencyKey: string, init: Init = {}) =>
  apiFetch<PaymentStart>(`/checkout/${encodeURIComponent(orderId)}/payment-attempts`, { method: "POST", idempotencyKey, auth: "customer", authOptional: true, ...init });

/** Server-to-server confirmation by Paystack reference after the shopper returns. A redirect alone proves nothing. */
export const verifyPayment = (reference: string, init: Init = {}) => apiFetch<CheckoutStatus>("/checkout/paystack/verify", { method: "POST", body: { reference }, ...init });

export const getCheckoutStatus = (orderId: string, init: Init = {}) => apiFetch<CheckoutStatus>(`/checkout/${encodeURIComponent(orderId)}/status`, { auth: "customer", authOptional: true, ...init });

export const trackOrder = (input: { orderNumber: string; phone: string }, init: Init = {}) => apiFetch<TrackResult>("/orders/track", { method: "POST", body: input, ...init });
