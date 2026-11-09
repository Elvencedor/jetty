import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { paymentAttempts, refunds } from '../../db/schema/index.js';
import type { Logger } from '../../lib/logger.js';
import { PaymentIndeterminateError, type PaymentProvider } from './provider.js';
import { applyRefundEvent } from './refund-events.js';

/** Refunds younger than this are left to the webhook, which normally reports them within moments. */
export const REFUND_RECONCILE_MIN_AGE_MS = 10 * 60 * 1000;
const BATCH = 50;

export type RefundReconcileResult = { checked: number; updated: number; errors: number };

/**
 * The safety net for lost refund webhooks: asks the provider about every charge that still has an unfinished refund
 * (one call per charge, however many refunds it has) and applies what it says through the same idempotent handler the
 * webhook uses. That handler also adopts refunds whose creation reply was lost. Harmless to run as often as you like;
 * if the provider cannot be reached the pass stops and the next one tries again.
 */
export async function reconcilePendingRefunds(
  db: Db,
  provider: PaymentProvider,
  logger: Logger,
  now: Date = new Date(),
  limit: number = BATCH,
): Promise<RefundReconcileResult> {
  const result: RefundReconcileResult = { checked: 0, updated: 0, errors: 0 };
  const waiting = await db
    .select({ charge: paymentAttempts.providerReference })
    .from(refunds)
    .innerJoin(paymentAttempts, eq(paymentAttempts.id, refunds.paymentAttemptId))
    .where(and(eq(paymentAttempts.provider, provider.name), inArray(refunds.status, ['pending', 'processing']), lte(refunds.createdAt, new Date(now.getTime() - REFUND_RECONCILE_MIN_AGE_MS))))
    .orderBy(asc(refunds.createdAt))
    .limit(limit);

  for (const charge of new Set(waiting.map((w) => w.charge))) {
    result.checked++;
    try {
      for (const r of await provider.listRefunds(charge)) {
        const outcome = await applyRefundEvent(db, provider.name, { event: `refund.${r.status}`, refundIds: [r.reference], transactionReference: charge, amountMinor: r.amountMinor });
        if (outcome === 'updated') result.updated++;
      }
    } catch (err) {
      result.errors++;
      logger.warn('refund reconciliation failed for a charge', { reference: charge, err: err instanceof Error ? err.message : String(err) });
      if (err instanceof PaymentIndeterminateError) break;
    }
  }
  return result;
}
