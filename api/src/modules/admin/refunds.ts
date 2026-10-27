import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import { notificationOutbox, orders, orderStatusEvents, paymentAttempts, refunds } from '../../db/schema/index.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { PaymentIndeterminateError, PaymentRejectedError, type PaymentProvider } from '../payments/provider.js';
import { MANUAL_TRANSACTION_PREFIX } from '../payments/settle.js';
import type { AuditEntry } from './audit.js';

export type RefundRequest = { amountMinor?: number | undefined; reason: string; paymentAttemptId?: string | undefined };
export type Recorder = (tx: Db | Tx, entry: AuditEntry) => Promise<void>;

export type RefundOutcome =
  | { ok: true; refundId: string; status: string; amountMinor: number; orderStatus: string; paymentStatus: string }
  | { ok: false; refundId: string; reason: 'UNCERTAIN'; amountMinor: number };

type Attempt = typeof paymentAttempts.$inferSelect;

/** The part of a successful charge that has not been (or is not being) refunded. Failed refunds free their amount again. */
async function remainingOf(tx: Db | Tx, attempt: Attempt): Promise<number> {
  const [row] = await tx
    .select({ sum: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::bigint` })
    .from(refunds)
    .where(and(eq(refunds.paymentAttemptId, attempt.id), ne(refunds.status, 'failed')));
  return attempt.amountMinor - Number(row?.sum ?? 0);
}

const isDoublePaid = (a: Attempt) => (a.providerTransactionId?.startsWith(MANUAL_TRANSACTION_PREFIX) ?? false) && Boolean((a.metadataRedacted as { realTransactionId?: string }).realTransactionId);

const money = (minor: number) => (minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Refunds a successful charge through the provider, fully or in part.
 *
 * Money is only ever refunded once: the refund row is written (reserving its
 * amount) before the provider is called, under the order lock, so concurrent or
 * repeated requests see it. A definitive refusal releases the amount; an unknown
 * outcome (timeout) keeps it reserved for a person to reconcile, because the
 * provider may have accepted the request.
 *
 * A refund of an extra charge (a duplicate) leaves the order intact; only when
 * what the customer has paid, net of refunds, falls below the order total does
 * the order itself become partially or fully refunded. Stock is not returned
 * automatically; adjust inventory if the goods come back.
 */
export async function refundOrder(
  db: Db,
  provider: PaymentProvider,
  adminId: string,
  orderId: string,
  input: RefundRequest,
  record: Recorder,
): Promise<RefundOutcome> {
  // Phase 1: validate and reserve the amount.
  const reserved = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw notFound('Order not found.');
    if (order.paymentStatus !== 'paid') throw conflict('ORDER_NOT_REFUNDABLE', 'Only an order with a confirmed payment can be refunded.');

    const succeeded = await tx.select().from(paymentAttempts).where(and(eq(paymentAttempts.orderId, orderId), eq(paymentAttempts.status, 'succeeded')));
    let attempt: Attempt | undefined;
    if (input.paymentAttemptId) {
      attempt = succeeded.find((a) => a.id === input.paymentAttemptId);
      if (!attempt) throw unprocessable('VALIDATION_FAILED', 'That payment does not belong to this order or did not succeed.', [{ path: 'paymentAttemptId', code: 'any.invalid' }]);
    } else if (succeeded.length === 1) {
      attempt = succeeded[0];
    } else if (succeeded.length > 1) {
      throw unprocessable('PAYMENT_ATTEMPT_REQUIRED', 'This order has more than one successful payment; say which one to refund.', succeeded.map((a) => ({ paymentAttemptId: a.id, reference: a.providerReference, amountMinor: a.amountMinor })));
    }
    if (!attempt) throw conflict('ORDER_NOT_REFUNDABLE', 'This order has no successful payment to refund.');

    // A hand-confirmed payment has no provider charge to refund unless the provider later reported one.
    const handConfirmed = attempt.providerTransactionId?.startsWith(MANUAL_TRANSACTION_PREFIX) ?? false;
    const realTransactionId = (attempt.metadataRedacted as { realTransactionId?: string }).realTransactionId;
    if (handConfirmed && !realTransactionId) {
      throw conflict('MANUAL_PAYMENT_NOT_REFUNDABLE', 'This payment was confirmed by hand, so the provider holds no charge to refund. Refund the customer from your bank and add an order note.');
    }

    const remaining = await remainingOf(tx, attempt);
    const amountMinor = input.amountMinor ?? remaining;
    if (amountMinor < 1 || amountMinor > remaining) {
      throw unprocessable('REFUND_AMOUNT_INVALID', `The refund must be between 1 and ${remaining} (the unrefunded part of this payment).`, [{ path: 'amountMinor', code: 'number.range', remainingMinor: remaining }]);
    }

    const [refund] = await tx
      .insert(refunds)
      .values({ paymentAttemptId: attempt.id, orderId, amountMinor, reason: input.reason, status: 'pending', createdByAdminId: adminId })
      .returning({ id: refunds.id });
    await record(tx, { action: 'order.refund.request', resourceType: 'order', resourceId: orderId, after: { refundId: refund!.id, amountMinor, reason: input.reason, paymentAttemptId: attempt.id } });
    return { refundId: refund!.id, attempt, amountMinor, order };
  });

  // Phase 2: the provider call, outside any transaction.
  let accepted: { providerReference: string; status: string };
  try {
    accepted = await provider.refund({ reference: reserved.attempt.providerReference, amountMinor: reserved.amountMinor, currency: reserved.attempt.currency, customerNote: input.reason.slice(0, 200), merchantNote: `Order ${reserved.order.orderNumber}` });
  } catch (err) {
    if (err instanceof PaymentRejectedError) {
      await db.transaction(async (tx) => {
        await tx.update(refunds).set({ status: 'failed' }).where(eq(refunds.id, reserved.refundId));
        await record(tx, { action: 'order.refund.rejected', resourceType: 'order', resourceId: orderId, after: { refundId: reserved.refundId, error: err.message } });
      });
      throw unprocessable('REFUND_REJECTED', 'The payment provider refused this refund.', [{ refundId: reserved.refundId }]);
    }
    if (err instanceof PaymentIndeterminateError) {
      await record(db, { action: 'order.refund.uncertain', resourceType: 'order', resourceId: orderId, after: { refundId: reserved.refundId } });
      return { ok: false, refundId: reserved.refundId, reason: 'UNCERTAIN', amountMinor: reserved.amountMinor };
    }
    throw err;
  }

  // Phase 3: record the provider's acceptance and update the order if it is no longer covered.
  return db.transaction(async (tx) => {
    await tx.update(refunds).set({ providerReference: accepted.providerReference, status: accepted.status }).where(eq(refunds.id, reserved.refundId));
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    // A payment confirmed by hand that the provider also charged was paid twice; everything else counts once.
    const succeeded = await tx.select().from(paymentAttempts).where(and(eq(paymentAttempts.orderId, orderId), eq(paymentAttempts.status, 'succeeded')));
    const paid = succeeded.reduce((sum, a) => sum + a.amountMinor * (isDoublePaid(a) ? 2 : 1), 0);
    const [refunded] = await tx
      .select({ sum: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::bigint` })
      .from(refunds)
      .where(and(eq(refunds.orderId, orderId), ne(refunds.status, 'failed')));
    const net = paid - Number(refunded?.sum ?? 0);

    let { status, paymentStatus } = order!;
    if (net <= 0) {
      await tx.update(orders).set({ status: 'refunded', paymentStatus: 'refunded' }).where(eq(orders.id, orderId));
      await tx.insert(orderStatusEvents).values({ orderId, fromStatus: status, toStatus: 'refunded', actorType: 'admin', actorId: adminId, note: 'REFUNDED_IN_FULL' });
      status = 'refunded';
      paymentStatus = 'refunded';
    } else if (net < order!.totalMinor) {
      await tx.insert(orderStatusEvents).values({ orderId, fromStatus: status, toStatus: status, actorType: 'admin', actorId: adminId, note: 'PARTIAL_REFUND' });
    } else {
      await tx.insert(orderStatusEvents).values({ orderId, fromStatus: status, toStatus: status, actorType: 'admin', actorId: adminId, note: 'EXTRA_CHARGE_REFUNDED' });
    }

    const payload = { orderId, orderNumber: order!.orderNumber, amount: money(reserved.amountMinor) };
    await tx.insert(notificationOutbox).values([
      { eventType: 'order.refunded', recipient: order!.phoneE164, channel: 'sms', payload },
      ...(order!.email ? [{ eventType: 'order.refunded', recipient: order!.email, channel: 'email', payload }] : []),
    ]);
    await record(tx, { action: 'order.refund.accepted', resourceType: 'order', resourceId: orderId, after: { refundId: reserved.refundId, providerReference: accepted.providerReference, providerStatus: accepted.status, orderStatus: status } });
    return { ok: true as const, refundId: reserved.refundId, status: accepted.status, amountMinor: reserved.amountMinor, orderStatus: status, paymentStatus };
  });
}
