import type { CheckoutRequest, DeliveryMethod, PaymentMethod } from "@/lib/api/types";
import { normaliseNigerianPhone } from "@/lib/format";
import type { CartLine } from "@/lib/stores/cart";
import type { DeliveryDetails } from "./validation";

const clean = (v: string) => v.trim();
const optional = (v: string) => (clean(v) ? clean(v) : undefined);

/**
 * The body of `POST /checkout`, or null if the details are not yet usable. Only ids, quantities and codes are the
 * client's word; the server prices everything. Optional fields are left out rather than sent empty.
 */
export function buildCheckoutRequest(input: { lines: CartLine[]; promotionCodes: string[]; details: DeliveryDetails; deliveryMethod: DeliveryMethod; paymentMethod: PaymentMethod }): CheckoutRequest | null {
  const { lines, promotionCodes, details, deliveryMethod, paymentMethod } = input;
  const phone = normaliseNigerianPhone(details.phone);
  if (!lines.length || !phone) return null;
  return {
    items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
    promotionCodes,
    contact: { phone, ...(optional(details.email) ? { email: clean(details.email).toLowerCase() } : {}) },
    deliveryAddress: {
      recipientName: clean(details.name),
      addressLine1: clean(details.addressLine1),
      ...(optional(details.area) ? { area: clean(details.area) } : {}),
      city: clean(details.city),
      state: clean(details.state),
      countryCode: "NG",
      ...(optional(details.landmark) ? { landmark: clean(details.landmark) } : {}),
      ...(optional(details.riderNote) ? { riderNote: clean(details.riderNote) } : {}),
    },
    deliveryMethod,
    paymentMethod,
    termsAccepted: true,
  };
}

/** A stable text form of a request. Two requests with the same fingerprint are the same submission. */
export function fingerprint(request: CheckoutRequest): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : value;
  return JSON.stringify(sorted(request));
}

export type Submission = { key: string; fingerprint: string };

/** An idempotency key: 36 characters, so it also meets the API's 32-character minimum for guests. */
export const newIdempotencyKey = () => crypto.randomUUID();

/**
 * The key to send. A retry of the same request (a double tap, a lost response) must reuse the key so the server
 * replays its answer instead of creating a second order; a changed request needs a new key, or the server answers
 * `409 IDEMPOTENCY_KEY_REUSED`.
 */
export function submissionFor(request: CheckoutRequest, previous: Submission | null, makeKey: () => string = newIdempotencyKey): Submission {
  const print = fingerprint(request);
  return previous && previous.fingerprint === print ? previous : { key: makeKey(), fingerprint: print };
}
