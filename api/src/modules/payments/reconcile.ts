import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { paymentAttempts } from '../../db/schema/index.js';
import type { Logger } from '../../lib/logger.js';
import { PaymentIndeterminateError, type PaymentProvider } from './provider.js';
import { settleTransaction } from './settle.js';

/** Attempts younger than this are left to the webhook and the customer's own return, which normally settle them. */
export const RECONCILE_MIN_AGE_MS = 2 * 60 * 1000;
/** An initializing attempt Paystack has never heard of is abandoned after this long, the same grace the retry path uses. */
const INITIALIZATION_GRACE_MS = 2 * 60 * 1000;
const BATCH = 50;

export type ReconcileResult = { checked: number; settled: number; failed: number; stillPending: number; errors: number };

/**
 * The safety net for lost webhooks: asks Paystack about attempts still waiting on a result (a bank transfer can land
 * minutes after the customer leaves the page) and applies the answer with the same idempotent settlement the webhook
 * and the browser return use. Running it as often as you like is harmless. If Paystack cannot be reached the pass stops
 * early and the next one tries again.
 */
export async function reconcilePendingPayments(
  db: Db,
  provider: PaymentProvider,
  logger: Logger,
  now: Date = new Date(),
  limit: number = BATCH,
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, settled: 0, failed: 0, stillPending: 0, errors: 0 };
  const waiting = await db
    .select({ id: paymentAttempts.id, reference: paymentAttempts.providerReference, status: paymentAttempts.status, createdAt: paymentAttempts.createdAt })
    .from(paymentAttempts)
    .where(
      and(
        eq(paymentAttempts.provider, provider.name),
        inArray(paymentAttempts.status, ['initializing', 'pending']),
        lte(paymentAttempts.createdAt, new Date(now.getTime() - RECONCILE_MIN_AGE_MS)),
      ),
    )
    .orderBy(asc(paymentAttempts.createdAt))
    .limit(limit);

  for (const attempt of waiting) {
    result.checked++;
    try {
      const verified = await provider.verify(attempt.reference);
      if (!verified.found) {
        if (attempt.status === 'initializing' && now.getTime() - attempt.createdAt.getTime() > INITIALIZATION_GRACE_MS) {
          await db.update(paymentAttempts).set({ status: 'failed' }).where(and(eq(paymentAttempts.id, attempt.id), eq(paymentAttempts.status, 'initializing')));
          result.failed++;
        } else result.stillPending++;
        continue;
      }
      const settlement = await settleTransaction(db, provider.name, verified, now);
      if (settlement.outcome === 'failed') result.failed++;
      else if (settlement.outcome === 'pending') result.stillPending++;
      else result.settled++;
    } catch (err) {
      result.errors++;
      logger.warn('payment reconciliation failed for an attempt', { reference: attempt.reference, err: err instanceof Error ? err.message : String(err) });
      // Paystack is unreachable: asking about the rest would only repeat the failure.
      if (err instanceof PaymentIndeterminateError) break;
    }
  }
  return result;
}
