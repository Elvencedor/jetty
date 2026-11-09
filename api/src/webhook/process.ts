import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { paymentAttempts } from '../db/schema/index.js';
import type { Logger } from '../lib/logger.js';
import { PaymentIndeterminateError, type PaymentProvider } from '../modules/payments/provider.js';
import { applyRefundEvent } from '../modules/payments/refund-events.js';
import { settleTransaction } from '../modules/payments/settle.js';

export type WebhookResult =
  | { status: 200; outcome: string }
  | { status: 400 }
  /** Provider lookup failed; Paystack will redeliver, so nothing is recorded as handled. */
  | { status: 503 };

type PaystackEvent = {
  event?: unknown;
  data?: {
    id?: unknown;
    reference?: unknown;
    refund_reference?: unknown;
    transaction_reference?: unknown;
    transaction?: { reference?: unknown } | null;
    amount?: unknown;
    deducted_amount?: unknown;
  };
};

const TERMINAL = new Set(['succeeded', 'failed', 'expired']);

/**
 * Handles an already signature-verified Paystack event. The body is only a
 * hint about which reference changed: state is applied solely from a
 * server-to-server verification of that reference, so a replayed or stale body
 * cannot move an order.
 *
 * There is no events table. Deduplication rests on settlement being idempotent,
 * plus the last applied event key kept on the payment attempt itself, which
 * lets a redelivery of a finished attempt be acknowledged without another
 * provider call. Events that match no attempt are logged (identifiers only).
 */
export async function handlePaystackEvent(db: Db, provider: PaymentProvider, rawBody: Buffer, logger?: Logger): Promise<WebhookResult> {
  let parsed: PaystackEvent;
  try {
    parsed = JSON.parse(rawBody.toString('utf8')) as PaystackEvent;
  } catch {
    return { status: 400 };
  }
  const event = typeof parsed?.event === 'string' ? parsed.event : null;
  if (!event) return { status: 400 };
  const reference = typeof parsed.data?.reference === 'string' ? parsed.data.reference : null;
  const transactionId = parsed.data?.id === undefined ? '' : String(parsed.data.id);

  if (event.startsWith('refund.')) {
    // Paystack's documented refund payloads differ by event: the charge is `transaction_reference` or a nested
    // `transaction.reference`, and the amount is a numeric string (`amount`) or a number (`deducted_amount`).
    const d = parsed.data ?? {};
    const refundIds = [d.id, d.refund_reference].filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String);
    const amount = Number(d.amount ?? d.deducted_amount);
    const nested = d.transaction && typeof d.transaction.reference === 'string' ? d.transaction.reference : null;
    const outcome = await applyRefundEvent(db, provider.name, {
      event,
      refundIds,
      transactionReference: typeof d.transaction_reference === 'string' ? d.transaction_reference : nested,
      amountMinor: Number.isInteger(amount) && amount > 0 ? amount : null,
    });
    if (outcome === 'unknown_refund') logger?.warn('webhook for unknown refund', { event, refundIds });
    return { status: 200, outcome };
  }

  if (!event.startsWith('charge.') || !reference) {
    logger?.info('webhook ignored', { event });
    return { status: 200, outcome: 'ignored' };
  }

  const key = `${event}:${reference}:${transactionId}`;
  const providerName = provider.name;
  const byReference = and(eq(paymentAttempts.provider, providerName), eq(paymentAttempts.providerReference, reference));

  const [attempt] = await db.select({ status: paymentAttempts.status, webhookEventKey: paymentAttempts.webhookEventKey }).from(paymentAttempts).where(byReference);
  if (!attempt) {
    logger?.warn('webhook for unknown reference', { event, reference });
    return { status: 200, outcome: 'ignored' };
  }
  if (attempt.webhookEventKey === key && TERMINAL.has(attempt.status)) return { status: 200, outcome: 'duplicate' };

  try {
    const verified = await provider.verify(reference);
    if (!verified.found) return { status: 200, outcome: 'transaction_not_found' };
    const settlement = await settleTransaction(db, providerName, verified);
    await db.update(paymentAttempts).set({ webhookEventKey: key, webhookReceivedAt: new Date() }).where(byReference);
    return { status: 200, outcome: settlement.outcome === 'unknown_reference' ? 'ignored' : settlement.outcome };
  } catch (err) {
    if (err instanceof PaymentIndeterminateError) return { status: 503 };
    throw err;
  }
}
