import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orders, orderStatusEvents, paymentAttempts, refunds } from '../../db/schema/index.js';

/** What a Paystack refund webhook tells us. Amounts are in minor units. */
export type RefundEvent = {
  /** 'refund.pending' | 'refund.processing' | 'refund.processed' | 'refund.failed' */
  event: string;
  /** Paystack's refund id and/or refund reference; either may be what we stored. */
  refundIds: string[];
  /** Reference of the charge that was refunded. */
  transactionReference: string | null;
  amountMinor: number | null;
};

export type RefundEventOutcome = 'updated' | 'duplicate' | 'unknown_refund' | 'ignored';

const STATUS_BY_EVENT: Record<string, string> = {
  'refund.pending': 'pending',
  'refund.processing': 'processing',
  'refund.processed': 'processed',
  'refund.failed': 'failed',
};
/** Once a refund has reached one of these it never moves again, so a late or replayed event cannot undo it. */
const FINAL = new Set(['processed', 'failed']);

/**
 * Applies a provider refund status change to our refund row. A refund we sent and never heard back about (timeout) has
 * no provider reference yet; it is matched by the charge it belongs to and its amount, and adopts the reference.
 *
 * When Paystack reports a refund failed, its amount is released again. If that refund had made the order "refunded",
 * the order goes back to the status it held before, and the failure is noted on its timeline so staff can act.
 */
export async function applyRefundEvent(db: Db, provider: string, e: RefundEvent): Promise<RefundEventOutcome> {
  const next = STATUS_BY_EVENT[e.event];
  if (!next) return 'ignored';

  return db.transaction(async (tx) => {
    let row: typeof refunds.$inferSelect | undefined;
    for (const id of e.refundIds) {
      [row] = await tx.select().from(refunds).where(eq(refunds.providerReference, id)).for('update');
      if (row) break;
    }
    if (!row && e.transactionReference && e.amountMinor !== null) {
      const [attempt] = await tx.select({ id: paymentAttempts.id }).from(paymentAttempts).where(and(eq(paymentAttempts.provider, provider), eq(paymentAttempts.providerReference, e.transactionReference)));
      if (attempt) {
        [row] = await tx
          .select()
          .from(refunds)
          .where(and(eq(refunds.paymentAttemptId, attempt.id), isNull(refunds.providerReference), eq(refunds.amountMinor, e.amountMinor), ne(refunds.status, 'failed')))
          .orderBy(asc(refunds.createdAt))
          .limit(1)
          .for('update');
      }
    }
    if (!row) return 'unknown_refund';
    if (row.status === next || FINAL.has(row.status)) return 'duplicate';

    await tx.update(refunds).set({ status: next, ...(row.providerReference ? {} : { providerReference: e.refundIds[0] ?? null }) }).where(eq(refunds.id, row.id));
    if (next !== 'failed') return 'updated';

    const [order] = await tx.select().from(orders).where(eq(orders.id, row.orderId)).for('update');
    if (!order) return 'updated';
    let status = order.status;
    if (order.paymentStatus === 'refunded') {
      const [paid] = await tx
        .select({ sum: sql<number>`coalesce(sum(${paymentAttempts.amountMinor}), 0)::bigint` })
        .from(paymentAttempts)
        .where(and(eq(paymentAttempts.orderId, order.id), eq(paymentAttempts.status, 'succeeded')));
      const [refunded] = await tx
        .select({ sum: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::bigint` })
        .from(refunds)
        .where(and(eq(refunds.orderId, order.id), ne(refunds.status, 'failed')));
      if (Number(paid?.sum ?? 0) - Number(refunded?.sum ?? 0) > 0) {
        const [was] = await tx
          .select({ from: orderStatusEvents.fromStatus })
          .from(orderStatusEvents)
          .where(and(eq(orderStatusEvents.orderId, order.id), eq(orderStatusEvents.toStatus, 'refunded'), eq(orderStatusEvents.note, 'REFUNDED_IN_FULL')))
          .orderBy(sql`${orderStatusEvents.createdAt} desc`)
          .limit(1);
        status = was?.from ?? 'cancelled';
        await tx.update(orders).set({ status, paymentStatus: 'paid' }).where(eq(orders.id, order.id));
      }
    }
    await tx.insert(orderStatusEvents).values({ orderId: order.id, fromStatus: order.status, toStatus: status, actorType: 'system', note: 'REFUND_FAILED' });
    return 'updated';
  });
}
