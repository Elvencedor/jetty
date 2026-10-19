import { paymentEmail } from './contact.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orders, paymentAttempts, stockReservations } from '../../db/schema/index.js';
import { apiError, conflict, notFound } from '../../lib/errors.js';
import { uniqueViolation } from '../../lib/sql.js';
import { PaymentIndeterminateError, type PaymentProvider } from '../payments/provider.js';
import { settleTransaction } from '../payments/settle.js';
import { initializeAttempt, newPaymentReference, paymentResponse, type PaymentMethod } from './checkout.js';

type Order = typeof orders.$inferSelect;
type Attempt = typeof paymentAttempts.$inferSelect;

/** An initializing attempt younger than this may still have its provider call in flight. */
const INITIALIZATION_GRACE_MS = 2 * 60 * 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Loads an order only for its owner: the customer, or a guest presenting the
 * unexpired checkout token. Every mismatch is a 404 so order IDs cannot be probed.
 */
export async function loadOwnedOrder(
  db: Db,
  orderId: string,
  access: { guestToken?: string | undefined; customerId?: string | undefined },
  now: Date = new Date(),
): Promise<Order> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  const ownedByCustomer = Boolean(order?.customerId && access.customerId && order.customerId === access.customerId);
  const ownedByGuest = Boolean(
    order?.guestCheckoutTokenHash &&
      order.guestCheckoutTokenExpiresAt &&
      order.guestCheckoutTokenExpiresAt > now &&
      access.guestToken &&
      sameHash(order.guestCheckoutTokenHash, sha256(access.guestToken)),
  );
  if (!order || !(ownedByCustomer || ownedByGuest)) throw notFound('Order not found.');
  return order;
}

async function latestAttempt(db: Db, orderId: string): Promise<Attempt | undefined> {
  const [attempt] = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId))
    .orderBy(desc(paymentAttempts.createdAt), desc(paymentAttempts.id))
    .limit(1);
  return attempt;
}

/** Minimal status for polling; never exposes contact details, addresses or provider identifiers. */
export async function orderStatus(db: Db, orderId: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) throw notFound('Order not found.');
  const attempt = await latestAttempt(db, o.id);
  return {
    orderId: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    amountMinor: o.totalMinor,
    currency: o.currency,
    reservationExpiresAt: o.reservationExpiresAt?.toISOString() ?? null,
    paymentAttempt: attempt ? { id: attempt.id, status: attempt.status } : null,
  };
}

const unavailable = () => apiError(503, 'PAYMENT_VERIFICATION_UNAVAILABLE', 'Payment verification is temporarily unavailable. Try again shortly.');

/**
 * Client-return verification: look the reference up with the provider and apply
 * the same idempotent transition as a webhook. The redirect itself proves nothing.
 */
export async function verifyByReference(db: Db, provider: PaymentProvider, reference: string, now: Date = new Date()) {
  const [attempt] = await db
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.provider, provider.name), eq(paymentAttempts.providerReference, reference)));
  if (!attempt) throw notFound('Payment reference not found.');

  if (attempt.status !== 'succeeded') {
    try {
      const verified = await provider.verify(reference);
      if (verified.found) await settleTransaction(db, provider.name, verified, now);
    } catch (err) {
      if (err instanceof PaymentIndeterminateError) throw unavailable();
      throw err;
    }
  }
  return orderStatus(db, attempt.orderId);
}

type Reconciled = 'settled' | 'failed' | 'active';

/** Resolves a previous attempt against the provider before another may start. */
async function reconcile(db: Db, provider: PaymentProvider, attempt: Attempt, now: Date): Promise<Reconciled> {
  let verified;
  try {
    verified = await provider.verify(attempt.providerReference);
  } catch (err) {
    if (err instanceof PaymentIndeterminateError) throw unavailable();
    throw err;
  }

  if (!verified.found) {
    // Never created at the provider; safe to abandon once the original call can no longer be in flight.
    if (attempt.status === 'initializing' && now.getTime() - attempt.createdAt.getTime() > INITIALIZATION_GRACE_MS) {
      await db.update(paymentAttempts).set({ status: 'failed' }).where(and(eq(paymentAttempts.id, attempt.id), eq(paymentAttempts.status, 'initializing')));
      return 'failed';
    }
    return 'active';
  }

  const result = await settleTransaction(db, provider.name, verified, now);
  if (result.outcome === 'failed') return 'failed';
  if (result.outcome === 'pending') return 'active';
  return 'settled';
}

export type RetryResult =
  | { status: 201; body: Record<string, unknown> }
  | { status: 502; error: { code: string; message: string; details: unknown[] } };

const notPayable = () => conflict('ORDER_NOT_PAYABLE', 'This order can no longer be paid. Please start a new checkout.');
const inProgress = () => conflict('PAYMENT_ATTEMPT_ACTIVE', 'A payment for this order is still in progress.');
const alreadyPaid = () => conflict('ORDER_ALREADY_PAID', 'This order has already been paid.');

/**
 * Starts a new payment attempt for an unpaid order. Allowed only while the
 * reservation is valid and the previous attempt is definitively failed or
 * expired, so a shopper can never be charged twice for one order.
 */
export async function retryPayment(
  db: Db,
  provider: PaymentProvider,
  order: Order,
  options: { callbackUrl?: string | undefined; emailDomain: string; now?: Date },
): Promise<RetryResult> {
  const now = options.now ?? new Date();

  const assertPayable = (o: Order) => {
    if (o.paymentStatus === 'paid') throw alreadyPaid();
    if (o.status !== 'pending_payment' || !o.reservationExpiresAt || o.reservationExpiresAt <= now) throw notPayable();
  };
  assertPayable(order);

  const previous = await latestAttempt(db, order.id);
  if (previous && (previous.status === 'initializing' || previous.status === 'pending')) {
    const outcome = await reconcile(db, provider, previous, now);
    if (outcome === 'settled') throw alreadyPaid();
    if (outcome === 'active') throw inProgress();
  }

  // A retry keeps the method the shopper chose at checkout.
  const method: PaymentMethod = previous?.method === 'bank_transfer' ? 'bank_transfer' : 'card';
  const reference = newPaymentReference();
  let attemptId: string;
  try {
    attemptId = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(orders).where(eq(orders.id, order.id)).for('update');
      assertPayable(locked!);
      const held = await tx
        .select({ id: stockReservations.id })
        .from(stockReservations)
        .where(and(eq(stockReservations.orderId, order.id), isNull(stockReservations.releasedAt), isNull(stockReservations.consumedAt)));
      if (held.length === 0) throw notPayable();

      const [attempt] = await tx
        .insert(paymentAttempts)
        .values({ orderId: order.id, provider: provider.name, providerReference: reference, method, amountMinor: order.totalMinor, currency: order.currency })
        .returning({ id: paymentAttempts.id });
      return attempt!.id;
    });
  } catch (err) {
    // The one-active-attempt unique index is the final guard against concurrent retries.
    if (uniqueViolation(err)) throw inProgress();
    throw err;
  }

  const started = await initializeAttempt(db, provider, {
    orderId: order.id,
    orderNumber: order.orderNumber,
    attemptId,
    reference,
    email: paymentEmail(order.email, order.phoneE164, options.emailDomain),
    amountMinor: order.totalMinor,
    currency: order.currency,
    method,
    callbackUrl: options.callbackUrl,
  });
  if (!started.ok) return { status: 502, error: started.error };
  return {
    status: 201,
    body: paymentResponse(provider.name, { orderId: order.id, orderNumber: order.orderNumber, attemptId }, started.init, order.totalMinor, order.currency, order.reservationExpiresAt!),
  };
}
