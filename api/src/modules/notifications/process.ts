import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { Logger } from '../../lib/logger.js';
import { PermanentSendError, type Senders } from './senders.js';
import { opsMessage, render, SECRET_EVENT_TYPES } from './templates.js';

export const MAX_ATTEMPTS = 6;
/** A claimed row is invisible to other workers this long; if the worker dies, the row is retried afterwards. */
const LEASE_SECONDS = 120;
const BATCH = 25;
const backoffSeconds = (attempt: number) => Math.min(30 * 2 ** (attempt - 1), 60 * 60);

type Claimed = { id: string; event_type: string; recipient: string; channel: string; payload: Record<string, unknown>; attempt_count: number };

export type OutboxResult = { sent: number; retried: number; failed: number };

/**
 * Sends due outbox rows. Delivery is at-least-once: a row is claimed (attempt
 * counted, leased) before sending, so a crash between send and bookkeeping
 * leads to one more send rather than a lost message. Rows are claimed with
 * SKIP LOCKED, so any number of workers can run this safely.
 */
export async function processOutbox(db: Db, senders: Senders, logger: Logger, now: Date = new Date(), options: { opsEmail?: string | undefined } = {}): Promise<OutboxResult> {
  const at = now.toISOString();
  const claimed = [
    ...(await db.execute<Claimed>(sql`
      update notification_outbox set status = 'sending', attempt_count = attempt_count + 1,
        next_attempt_at = ${at}::timestamptz + make_interval(secs => ${LEASE_SECONDS})
      where id in (
        select id from notification_outbox
        where status in ('pending', 'sending') and next_attempt_at <= ${at}::timestamptz
        order by next_attempt_at limit ${BATCH} for update skip locked)
      returning id, event_type, recipient, channel, payload, attempt_count`)),
  ];

  const result: OutboxResult = { sent: 0, retried: 0, failed: 0 };
  for (const row of claimed) result[await deliver(db, senders, logger, row, at, options.opsEmail)]++;
  return result;
}

async function deliver(db: Db, senders: Senders, logger: Logger, row: Claimed, at: string, opsEmail?: string): Promise<keyof OutboxResult> {
  // One-time codes live in the payload only until the message reaches a terminal state.
  const scrub = SECRET_EVENT_TYPES.includes(row.event_type) ? sql`payload = payload - 'code',` : sql``;
  const fail = async (error: string) => {
    await db.execute(sql`update notification_outbox set status = 'failed', ${scrub} last_error = ${error} where id = ${row.id}`);
    logger.error('notification failed permanently', { outboxId: row.id, eventType: row.event_type, channel: row.channel, error });
    return 'failed' as const;
  };

  if (row.channel === 'internal') {
    logger.warn('operations alert', { eventType: row.event_type, ...row.payload });
    if (opsEmail) {
      try {
        await senders.email.send({ to: opsEmail, ...opsMessage(row.event_type, row.payload) });
      } catch (err) {
        if (err instanceof PermanentSendError) return fail(err.message.slice(0, 500));
        const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        if (row.attempt_count >= MAX_ATTEMPTS) return fail(`${error} (attempt ${row.attempt_count})`);
        await db.execute(sql`update notification_outbox set status = 'pending', last_error = ${error}, next_attempt_at = ${at}::timestamptz + make_interval(secs => ${backoffSeconds(row.attempt_count)}) where id = ${row.id}`);
        return 'retried';
      }
    }
    await db.execute(sql`update notification_outbox set status = 'sent', sent_at = ${at}::timestamptz where id = ${row.id}`);
    return 'sent';
  }
  if (row.channel !== 'sms' && row.channel !== 'email') return fail(`unknown channel ${row.channel}`);
  const message = render(row.event_type, row.channel, row.recipient, row.payload);
  if (!message) return fail(`no template for ${row.event_type}`);
  if (row.attempt_count > MAX_ATTEMPTS) return fail('gave up after repeated attempts');

  try {
    const { providerMessageId } = await senders[row.channel].send(message);
    await db.execute(
      sql`update notification_outbox set status = 'sent', ${scrub} sent_at = ${at}::timestamptz, last_error = null, provider_message_id = ${providerMessageId ?? null} where id = ${row.id}`,
    );
    return 'sent';
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    if (err instanceof PermanentSendError) return fail(error);
    if (row.attempt_count >= MAX_ATTEMPTS) return fail(`${error} (attempt ${row.attempt_count})`);
    await db.execute(
      sql`update notification_outbox set status = 'pending', last_error = ${error}, next_attempt_at = ${at}::timestamptz + make_interval(secs => ${backoffSeconds(row.attempt_count)}) where id = ${row.id}`,
    );
    logger.warn('notification send failed; will retry', { outboxId: row.id, eventType: row.event_type, attempt: row.attempt_count, error });
    return 'retried';
  }
}

/** Seconds the oldest due, undelivered row has been waiting (0 if none); for backlog alerting. */
export async function oldestPendingSeconds(db: Db, now: Date = new Date()): Promise<number> {
  const at = now.toISOString();
  const [row] = [
    ...(await db.execute<{ age: number | null }>(sql`
      select extract(epoch from (${at}::timestamptz - min(next_attempt_at)))::int as age
      from notification_outbox where status = 'pending' and next_attempt_at <= ${at}::timestamptz`)),
  ];
  return Math.max(0, row?.age ?? 0);
}
