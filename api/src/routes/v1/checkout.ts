import type { Request, ResponseObject, ResponseToolkit, ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { apiError, unprocessable } from '../../lib/errors.js';
import { abandonIdempotent, beginIdempotent, completeIdempotent, hashRequest } from '../../lib/idempotency.js';
import { LIMITS } from '../../lib/rate-policies.js';
import { withLineImages } from '../../modules/media/urls.js';
import { deriveToken } from '../../lib/tokens.js';
import { checkout, GUEST_TOKEN_TTL_MS, type CheckoutInput } from '../../modules/checkout/checkout.js';
import { loadOwnedOrder, orderStatus, retryPayment, verifyByReference } from '../../modules/checkout/orders.js';
import { DELIVERY_METHODS } from '../../modules/delivery/zones.js';
import { db, NO_STORE } from './shared.js';

export const CHECKOUT_COOKIE = 'jh_checkout';

const text = (max: number) => Joi.string().trim().min(1).max(max);

const payload = Joi.object({
  items: Joi.array()
    .items(Joi.object({ variantId: Joi.string().uuid().required(), quantity: Joi.number().integer().min(1).max(99).required() }))
    .min(1)
    .max(50)
    .required(),
  promotionCodes: Joi.array().items(text(64)).max(5).default([]),
  contact: Joi.object({
    email: Joi.string().trim().lowercase().email().max(254),
    phone: Joi.string().trim().pattern(/^\+[1-9]\d{7,14}$/).required().messages({ 'string.pattern.base': 'phone must be in E.164 format, e.g. +2348012345678' }),
  }).required(),
  deliveryAddress: Joi.object({
    recipientName: text(120).required(),
    addressLine1: text(200).required(),
    addressLine2: text(200),
    area: text(120),
    city: text(120).required(),
    state: text(80).required(),
    countryCode: Joi.string().uppercase().valid('NG').default('NG'),
    landmark: text(200),
    riderNote: text(300),
  }).required(),
  deliveryMethod: Joi.string()
    .valid(...DELIVERY_METHODS)
    .required(),
  // Card and bank transfer are P0; USSD and pay-on-delivery are P1.
  paymentMethod: Joi.string().valid('card', 'bank_transfer').required(),
  termsAccepted: Joi.boolean().valid(true).required(),
});

type StoredError = { error: { code: string; message: string; details: unknown[] } };

const idempotencyHeader = Joi.object({
  'idempotency-key': Joi.string()
    .min(16)
    .max(128)
    .pattern(/^[A-Za-z0-9._~-]+$/)
    .required(),
}).unknown(true);

const paymentsOf = (request: Request) => {
  const payments = request.server.app.payments;
  if (!payments) throw apiError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are temporarily unavailable.');
  return payments;
};

const checkoutOptions = (request: Request) => ({
  callbackUrl: request.server.app.env.PAYSTACK_CALLBACK_URL,
  emailDomain: request.server.app.env.PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN,
});

const customerId = (request: Request) => (request.auth.isAuthenticated ? request.auth.credentials.customerId : undefined);

const setCheckoutCookie = (response: ResponseObject, token: string) =>
  response.state(CHECKOUT_COOKIE, token, { isSecure: true, isHttpOnly: true, isSameSite: 'Lax', path: '/api/v1/checkout', ttl: GUEST_TOKEN_TTL_MS, encoding: 'none' });

/** Guest checkouts need an unguessable key: whoever holds it can replay the order and receive its cookie. */
const GUEST_KEY_MIN_LENGTH = 32;

const guestToken = (request: Request) => {
  const value = request.state[CHECKOUT_COOKIE];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Runs a state-changing handler under an Idempotency-Key. The same key and
 * payload replays the stored response. A 4xx created nothing, so it frees the
 * key for a corrected retry; anything else stays claimed because an order or
 * attempt may exist and must not be blindly resubmitted.
 */
async function idempotent(
  request: Request,
  h: ResponseToolkit,
  scope: string,
  requestBody: unknown,
  run: () => Promise<{ status: number; body: unknown; decorate?: (response: ResponseObject) => void }>,
  /** Applied to a replayed response, e.g. to hand a guest their checkout cookie again. */
  decorateReplay?: (response: ResponseObject) => void,
) {
  const database = db(request);
  const requestId = request.app.requestId ?? 'unknown';
  const storage = request.server.app.storage;
  // Image URLs are added on the way out (never stored), so a replayed response gets current URLs.
  const withImages = (body: unknown): object => {
    const quote = (body as { quote?: { lines: { image: { objectKey: string } | null }[] } }).quote;
    return quote ? { ...(body as object), quote: withLineImages(storage, quote) } : (body as object);
  };
  const respond = (status: number, body: unknown) =>
    status >= 400
      ? h.response({ error: { ...(body as StoredError).error, requestId } }).code(status)
      : h.response(withImages(body)).code(status);

  const started = await beginIdempotent(database, { scope, key: String(request.headers['idempotency-key']), requestHash: hashRequest(requestBody) });
  if (started.kind === 'replay') {
    const replayed = respond(started.status, started.body);
    decorateReplay?.(replayed);
    return replayed.header('Cache-Control', NO_STORE);
  }

  try {
    const result = await run();
    await completeIdempotent(database, started.id, result.status, result.body);
    const response = respond(result.status, result.body);
    result.decorate?.(response);
    return response.header('Cache-Control', NO_STORE);
  } catch (err) {
    const status = (err as { output?: { statusCode?: number } }).output?.statusCode;
    if (status && status < 500) await abandonIdempotent(database, started.id);
    throw err;
  }
}

export const checkoutRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/checkout',
    options: {
      auth: { strategy: 'customer', mode: 'optional' },
      plugins: { rateLimit: { ip: [LIMITS.checkout] } },
      description: 'Recalculate, create a pending_payment order with stock reservation, and initialize payment',
      tags: ['api', 'checkout'],
      validate: { headers: idempotencyHeader, payload },
    },
    handler: (request, h) => {
      const payments = paymentsOf(request);
      const body = request.payload as CheckoutInput & { termsAccepted: true };
      const customer = customerId(request);
      const key = String(request.headers['idempotency-key']);
      if (!customer && key.length < GUEST_KEY_MIN_LENGTH) {
        throw unprocessable('VALIDATION_FAILED', `Idempotency-Key must be at least ${GUEST_KEY_MIN_LENGTH} characters for guest checkout; use a random UUID.`, [{ path: 'idempotency-key', code: 'string.min' }]);
      }
      const secret = request.server.app.env.AUTH_TOKEN_SECRET;
      const derived = !customer && secret ? deriveToken(secret, 'guest-checkout', key) : undefined;
      return idempotent(
        request,
        h,
        customer ? `checkout:customer:${customer}` : 'checkout:guest',
        body,
        async () => {
          const result = await checkout(db(request), payments, body, { ...checkoutOptions(request), customerId: customer, guestToken: derived });
          return {
            status: result.status,
            body: result.status === 201 ? result.body : { error: result.error },
            decorate: (response) => {
              if (result.guestToken) setCheckoutCookie(response, result.guestToken);
            },
          };
        },
        derived ? (response) => setCheckoutCookie(response, derived) : undefined,
      );
    },
  },
  {
    method: 'POST',
    path: '/checkout/{orderId}/payment-attempts',
    options: {
      auth: { strategy: 'customer', mode: 'optional' },
      plugins: { rateLimit: { ip: [LIMITS.payment] } },
      description: 'Start a new payment attempt once the previous one has definitively failed or expired',
      tags: ['api', 'checkout'],
      validate: { headers: idempotencyHeader, params: Joi.object({ orderId: Joi.string().uuid().required() }) },
    },
    handler: (request, h) => {
      const payments = paymentsOf(request);
      const { orderId } = request.params as { orderId: string };
      return idempotent(request, h, `payment-attempt:${orderId}`, { orderId }, async () => {
        const order = await loadOwnedOrder(db(request), orderId, { guestToken: guestToken(request), customerId: customerId(request) });
        const result = await retryPayment(db(request), payments, order, checkoutOptions(request));
        return { status: result.status, body: result.status === 201 ? result.body : { error: result.error } };
      });
    },
  },
  {
    method: 'GET',
    path: '/checkout/{orderId}/status',
    options: {
      auth: { strategy: 'customer', mode: 'optional' },
      description: 'Minimal payment/order status for the owning customer or guest checkout token',
      tags: ['api', 'checkout'],
      validate: { params: Joi.object({ orderId: Joi.string().uuid().required() }) },
    },
    handler: async (request, h) => {
      const order = await loadOwnedOrder(db(request), (request.params as { orderId: string }).orderId, { guestToken: guestToken(request), customerId: customerId(request) });
      return h.response(await orderStatus(db(request), order.id)).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'POST',
    path: '/checkout/paystack/verify',
    options: {
      auth: false,
      plugins: { rateLimit: { ip: [LIMITS.payment] } },
      description: 'Verify a Paystack transaction server-to-server by reference after the client returns',
      tags: ['api', 'checkout'],
      validate: { payload: Joi.object({ reference: Joi.string().trim().min(8).max(100).required() }) },
    },
    handler: async (request, h) => {
      const payments = paymentsOf(request);
      const { reference } = request.payload as { reference: string };
      return h.response(await verifyByReference(db(request), payments, reference)).header('Cache-Control', NO_STORE);
    },
  },
];
