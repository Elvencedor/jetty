import { releasePromotionHolds } from '../promotions/holds.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import {
  inventory,
  inventoryMovements,
  notificationOutbox,
  orders,
  orderStatusEvents,
  paymentAttempts,
  promotionCodes,
  promotionRedemptions,
  promotions,
  stockReservations,
} from '../../db/schema/index.js';
import type { VerifiedTransaction } from './provider.js';

export type AppliedPromotionSnapshot = {
  promotionId: string;
  promotionCodeId: string | null;
  code: string | null;
  discountMinor: number;
};

export type SettlementOutcome =
  | 'unknown_reference'
  | 'paid'
  | 'already_settled'
  | 'duplicate_charge'
  | 'late_payment'
  | 'amount_mismatch'
  | 'failed'
  | 'pending';

export type Settlement = { outcome: SettlementOutcome; orderId?: string };

const FAILED_PROVIDER_STATUSES = new Set(['failed', 'reversed']);

/**
 * The single, idempotent payment state transition shared by the webhook and
 * the client-return verification. `verified` must come from a server-to-server
 * provider lookup; nothing asserted by a browser or a webhook body is trusted.
 *
 * The order row is locked first (the same order expiry takes), so concurrent
 * deliveries, a verify call and expiry serialise. A confirmed charge is never
 * discarded: late, duplicate and mismatched payments are recorded and flagged.
 * Promotion usage is claimed here, and only here, exactly once per order.
 */
export async function settleTransaction(
  db: Db,
  providerName: string,
  verified: Extract<VerifiedTransaction, { found: true }>,
  now: Date = new Date(),
): Promise<Settlement> {
  return db.transaction(async (tx) => {
    const [lookup] = await tx
      .select({ orderId: paymentAttempts.orderId })
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.provider, providerName), eq(paymentAttempts.providerReference, verified.reference)));
    if (!lookup) return { outcome: 'unknown_reference' };

    const [order] = await tx.select().from(orders).where(eq(orders.id, lookup.orderId)).for('update');
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.provider, providerName), eq(paymentAttempts.providerReference, verified.reference)))
      .for('update');
    if (!order || !attempt) return { outcome: 'unknown_reference' };
    const orderId = order.id;

    if (verified.status !== 'success') {
      if (attempt.status === 'succeeded') return { outcome: 'already_settled', orderId };
      if (FAILED_PROVIDER_STATUSES.has(verified.status)) {
        if (attempt.status === 'initializing' || attempt.status === 'pending') {
          await tx.update(paymentAttempts).set({ status: 'failed' }).where(eq(paymentAttempts.id, attempt.id));
        }
        return { outcome: 'failed', orderId };
      }
      // Provider knows the transaction, so a timed-out initialization did reach it.
      if (attempt.status === 'initializing') {
        await tx.update(paymentAttempts).set({ status: 'pending', initializedAt: now }).where(eq(paymentAttempts.id, attempt.id));
      }
      return { outcome: 'pending', orderId };
    }

    if (verified.amountMinor !== attempt.amountMinor || verified.currency !== attempt.currency) {
      await tx
        .update(paymentAttempts)
        .set({
          providerTransactionId: attempt.providerTransactionId ?? verified.transactionId,
          metadataRedacted: sql`${paymentAttempts.metadataRedacted} || ${JSON.stringify({
            reconciliation: 'AMOUNT_MISMATCH',
            providerAmountMinor: verified.amountMinor,
            providerCurrency: verified.currency,
          })}::jsonb`,
        })
        .where(eq(paymentAttempts.id, attempt.id));
      if (order.status === 'pending_payment') {
        await tx.update(orders).set({ status: 'payment_exception' }).where(eq(orders.id, orderId));
        await recordEvent(tx, orderId, 'pending_payment', 'payment_exception', 'AMOUNT_MISMATCH');
      }
      await alertOperations(tx, orderId, order.orderNumber, 'AMOUNT_MISMATCH');
      return { outcome: 'amount_mismatch', orderId };
    }

    if (attempt.status === 'succeeded') return { outcome: 'already_settled', orderId };

    await tx
      .update(paymentAttempts)
      .set({ status: 'succeeded', paidAt: verified.paidAt ?? now, providerTransactionId: attempt.providerTransactionId ?? verified.transactionId })
      .where(eq(paymentAttempts.id, attempt.id));

    if (order.paymentStatus === 'paid') {
      await recordEvent(tx, orderId, order.status, order.status, 'DUPLICATE_CHARGE');
      await alertOperations(tx, orderId, order.orderNumber, 'DUPLICATE_CHARGE');
      return { outcome: 'duplicate_charge', orderId };
    }

    const reservations = await tx.select().from(stockReservations).where(eq(stockReservations.orderId, orderId));
    const stockReleased = reservations.length === 0 || reservations.some((r) => r.releasedAt !== null);
    if (order.status !== 'pending_payment' || stockReleased) {
      // Money was received but the order can no longer be fulfilled from reserved stock.
      await tx.update(orders).set({ status: 'payment_exception', paymentStatus: 'paid' }).where(eq(orders.id, orderId));
      await recordEvent(tx, orderId, order.status, 'payment_exception', 'LATE_PAYMENT');
      await alertOperations(tx, orderId, order.orderNumber, 'LATE_PAYMENT');
      return { outcome: 'late_payment', orderId };
    }

    const consumed = await tx
      .update(stockReservations)
      .set({ consumedAt: now })
      .where(and(eq(stockReservations.orderId, orderId), isNull(stockReservations.releasedAt), isNull(stockReservations.consumedAt)))
      .returning({ variantId: stockReservations.variantId, quantity: stockReservations.quantity });
    for (const line of consumed.sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      await tx
        .update(inventory)
        .set({
          onHandQuantity: sql`${inventory.onHandQuantity} - ${line.quantity}`,
          reservedQuantity: sql`${inventory.reservedQuantity} - ${line.quantity}`,
        })
        .where(eq(inventory.variantId, line.variantId));
      await tx.insert(inventoryMovements).values({
        variantId: line.variantId,
        quantityDelta: -line.quantity,
        reason: 'sale',
        orderId,
        reference: order.orderNumber,
      });
    }

    await tx.update(orders).set({ status: 'placed', paymentStatus: 'paid', placedAt: now }).where(eq(orders.id, orderId));
    await recordEvent(tx, orderId, 'pending_payment', 'placed', 'PAYMENT_VERIFIED');

    await releasePromotionHolds(tx, [orderId]);
    await claimPromotions(tx, order.id, order.customerId, order.appliedPromotions as AppliedPromotionSnapshot[]);

    // Phone is the primary channel; email is an extra copy when the customer gave one.
    const payload = { orderId, orderNumber: order.orderNumber };
    await tx.insert(notificationOutbox).values([
      { eventType: 'order.placed', recipient: order.phoneE164, channel: 'sms', payload },
      ...(order.email ? [{ eventType: 'order.placed', recipient: order.email, channel: 'email', payload }] : []),
    ]);

    return { outcome: 'paid', orderId };
  });
}

/**
 * Records redemptions and increments usage. The unique (promotion, order)
 * index makes this exactly-once; counters move only when a row was inserted.
 * The shopper has already paid the discounted total, so limits are not
 * re-checked here: checkout already took a hold on the slot, so counts cannot
 * exceed the limit.
 */
async function claimPromotions(tx: Tx, orderId: string, customerId: string | null, applied: AppliedPromotionSnapshot[]) {
  // Same lock order as checkout (promotions, then codes, by id) so the two cannot deadlock.
  for (const p of [...applied].sort((a, b) => a.promotionId.localeCompare(b.promotionId))) {
    const inserted = await tx
      .insert(promotionRedemptions)
      .values({ promotionId: p.promotionId, promotionCodeId: p.promotionCodeId, customerId, orderId, discountMinor: p.discountMinor })
      .onConflictDoNothing()
      .returning({ id: promotionRedemptions.id });
    if (inserted.length === 0) continue;
    await tx.update(promotions).set({ usageCount: sql`${promotions.usageCount} + 1` }).where(eq(promotions.id, p.promotionId));
    if (p.promotionCodeId) {
      await tx
        .update(promotionCodes)
        .set({ redemptionCount: sql`${promotionCodes.redemptionCount} + 1` })
        .where(eq(promotionCodes.id, p.promotionCodeId));
    }
  }
}

const recordEvent = (tx: Tx, orderId: string, from: typeof orders.$inferSelect.status, to: typeof orders.$inferSelect.status, note: string) =>
  tx.insert(orderStatusEvents).values({ orderId, fromStatus: from, toStatus: to, actorType: 'system', note });

const alertOperations = (tx: Tx, orderId: string, orderNumber: string, reason: string) =>
  tx.insert(notificationOutbox).values({
    eventType: 'payment.exception',
    recipient: 'operations',
    channel: 'internal',
    payload: { orderId, orderNumber, reason },
  });
