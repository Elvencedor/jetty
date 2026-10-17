import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { paymentWebhookEvents } from '../db/schema/index.js';
import { PaymentIndeterminateError, type PaymentProvider } from '../modules/payments/provider.js';
import { settleTransaction } from '../modules/payments/settle.js';

export type WebhookResult =
  | { status: 200; outcome: string }
  | { status: 400 }
  /** Provider lookup failed; Paystack will redeliver, and the event row stays unprocessed until it succeeds. */
  | { status: 503 };

type PaystackEvent = {
  event?: unknown;
  data?: { id?: unknown; reference?: unknown; status?: unknown; amount?: unknown; currency?: unknown; channel?: unknown };
};

/**
 * Handles an already signature-verified Paystack event. The body is only a
 * hint about which reference changed: state is applied solely from a
 * server-to-server verification of that reference, so a replayed or stale body
 * cannot move an order.
 */
export async function handlePaystackEvent(db: Db, provider: PaymentProvider, rawBody: Buffer): Promise<WebhookResult> {
  let parsed: PaystackEvent;
  try {
    parsed = JSON.parse(rawBody.toString('utf8')) as PaystackEvent;
  } catch {
    return { status: 400 };
  }
  const event = typeof parsed?.event === 'string' ? parsed.event : null;
  const reference = typeof parsed.data?.reference === 'string' ? parsed.data.reference : null;
  if (!event) return { status: 400 };

  const transactionId = parsed.data?.id === undefined ? '' : String(parsed.data.id);
  const key = `${event}:${reference ?? ''}:${transactionId}`;
  const providerName = provider.name;

  // Only identifiers and amounts are kept; no customer, card or authorization data.
  const payloadRedacted = {
    event,
    reference,
    transactionId: transactionId || null,
    status: typeof parsed.data?.status === 'string' ? parsed.data.status : null,
    amount: typeof parsed.data?.amount === 'number' ? parsed.data.amount : null,
    currency: typeof parsed.data?.currency === 'string' ? parsed.data.currency : null,
    channel: typeof parsed.data?.channel === 'string' ? parsed.data.channel : null,
  };

  const inserted = await db
    .insert(paymentWebhookEvents)
    .values({ provider: providerName, providerEventKey: key, payloadRedacted })
    .onConflictDoNothing()
    .returning({ id: paymentWebhookEvents.id });

  let eventId = inserted[0]?.id;
  if (!eventId) {
    const [existing] = await db
      .select({ id: paymentWebhookEvents.id, processedAt: paymentWebhookEvents.processedAt })
      .from(paymentWebhookEvents)
      .where(and(eq(paymentWebhookEvents.provider, providerName), eq(paymentWebhookEvents.providerEventKey, key)));
    if (existing?.processedAt) return { status: 200, outcome: 'duplicate' };
    eventId = existing?.id;
  }

  const finish = async (outcome: string): Promise<WebhookResult> => {
    if (eventId) {
      await db
        .update(paymentWebhookEvents)
        .set({ processedAt: new Date(), processingStatus: outcome })
        .where(eq(paymentWebhookEvents.id, eventId));
    }
    return { status: 200, outcome };
  };

  if (!event.startsWith('charge.') || !reference) return finish('ignored');

  try {
    const verified = await provider.verify(reference);
    if (!verified.found) return finish('transaction_not_found');
    const settlement = await settleTransaction(db, providerName, verified);
    return finish(settlement.outcome === 'unknown_reference' ? 'ignored' : settlement.outcome);
  } catch (err) {
    if (err instanceof PaymentIndeterminateError) return { status: 503 };
    throw err;
  }
}
