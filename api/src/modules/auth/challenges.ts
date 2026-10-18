import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { authChallenges, notificationOutbox } from '../../db/schema/index.js';
import { apiError } from '../../lib/errors.js';
import { hmacSha256, sameHash } from '../../lib/tokens.js';
import { OTP_TTL_MINUTES } from '../notifications/templates.js';

export type Purpose = 'login' | 'password_reset';
export type Channel = 'sms' | 'email';

export const CODE_TTL_MS = OTP_TTL_MINUTES * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** Wrong guesses allowed per code; a six-digit code must not survive a brute-force run. */
export const MAX_ATTEMPTS = 5;

const invalidCode = () => apiError(401, 'INVALID_CODE', 'The code is incorrect or has expired.');

const digest = (secret: string, purpose: Purpose, identifier: string, code: string) => hmacSha256(secret, `${purpose}:${identifier}:${code}`);

type Issue = { purpose: Purpose; identifier: string; channel: Channel; customerId?: string | null };

/**
 * Creates a one-time code and queues its delivery in the same transaction, so
 * a code is never issued without a message and vice versa. A new code
 * supersedes older ones, and requests inside the cooldown are ignored
 * silently (the caller sees the same response), which caps SMS spend per
 * number even if the rate limiter is down.
 */
export async function issueChallenge(db: Db, secret: string, input: Issue, now: Date = new Date()): Promise<'issued' | 'cooldown'> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.purpose}:${input.identifier}`}))`);
    const [latest] = await tx
      .select({ createdAt: authChallenges.createdAt })
      .from(authChallenges)
      .where(and(eq(authChallenges.identifier, input.identifier), eq(authChallenges.purpose, input.purpose)))
      .orderBy(desc(authChallenges.createdAt))
      .limit(1);
    if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) return 'cooldown';

    await tx
      .update(authChallenges)
      .set({ consumedAt: now })
      .where(and(eq(authChallenges.identifier, input.identifier), eq(authChallenges.purpose, input.purpose), isNull(authChallenges.consumedAt)));

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await tx.insert(authChallenges).values({
      customerId: input.customerId ?? null,
      identifier: input.identifier,
      purpose: input.purpose,
      secretHash: digest(secret, input.purpose, input.identifier, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      createdAt: now,
    });
    await tx.insert(notificationOutbox).values({
      eventType: input.purpose === 'login' ? 'auth.otp' : 'auth.password_reset',
      recipient: input.identifier,
      channel: input.channel,
      payload: { code },
    });
    return 'issued';
  });
}

/**
 * Checks a code and consumes it. Every outcome other than success is the same
 * `INVALID_CODE`, so a caller cannot tell a wrong code from an expired,
 * used-up or never-issued one. The attempt is counted before comparing, and
 * consumption is a guarded update, so one code can be spent exactly once even
 * under concurrent requests.
 */
export async function consumeChallenge(
  db: Db,
  secret: string,
  input: { purpose: Purpose; identifier: string; code: string },
  now: Date = new Date(),
): Promise<{ customerId: string | null }> {
  const [current] = await db
    .select({ id: authChallenges.id })
    .from(authChallenges)
    .where(and(eq(authChallenges.identifier, input.identifier), eq(authChallenges.purpose, input.purpose), isNull(authChallenges.consumedAt), gt(authChallenges.expiresAt, now)))
    .orderBy(desc(authChallenges.createdAt))
    .limit(1);
  if (!current) throw invalidCode();

  const [attempt] = await db
    .update(authChallenges)
    .set({ attemptCount: sql`${authChallenges.attemptCount} + 1` })
    .where(and(eq(authChallenges.id, current.id), isNull(authChallenges.consumedAt), lt(authChallenges.attemptCount, MAX_ATTEMPTS)))
    .returning({ secretHash: authChallenges.secretHash, customerId: authChallenges.customerId });
  if (!attempt || !sameHash(attempt.secretHash, digest(secret, input.purpose, input.identifier, input.code))) throw invalidCode();

  const spent = await db
    .update(authChallenges)
    .set({ consumedAt: now })
    .where(and(eq(authChallenges.id, current.id), isNull(authChallenges.consumedAt)))
    .returning({ id: authChallenges.id });
  if (spent.length === 0) throw invalidCode();
  return { customerId: attempt.customerId };
}

/** Drops challenges that expired more than a day ago. */
export async function cleanupChallenges(db: Db, now: Date = new Date()): Promise<number> {
  const removed = await db
    .delete(authChallenges)
    .where(lt(authChallenges.expiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)))
    .returning({ id: authChallenges.id });
  return removed.length;
}

/** Strips one-time codes from outbox rows that never reached a terminal state (e.g. stuck retries). */
export async function scrubStaleCodes(db: Db, now: Date = new Date()): Promise<number> {
  const at = now.toISOString();
  const rows = await db.execute(sql`
    update notification_outbox set status = case when status in ('pending', 'sending') then 'failed' else status end,
      last_error = case when status in ('pending', 'sending') then 'code expired before delivery' else last_error end,
      payload = payload - 'code'
    where event_type in ('auth.otp', 'auth.password_reset') and payload ? 'code'
      and created_at < ${at}::timestamptz - make_interval(secs => ${CODE_TTL_MS / 1000})
    returning id`);
  return [...rows].length;
}
