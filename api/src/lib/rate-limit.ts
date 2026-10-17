import { lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rateLimitBuckets } from '../db/schema/index.js';
import { apiError } from './errors.js';
import { sha256 } from './tokens.js';

export type Policy = { name: string; limit: number; windowMs: number };

export type Decision = { allowed: boolean; count: number; retryAfterSeconds: number };

/** Subjects (IPs, phone numbers, order numbers) are hashed so the table never holds raw identifiers. */
const bucketKey = (policy: Policy, subject: string) => `${policy.name}:${sha256(subject.trim().toLowerCase())}`;

/**
 * Counts one hit against a fixed window in a single atomic upsert, so every
 * API replica shares the same counter and concurrent requests cannot slip past
 * the limit. A fixed window allows up to twice the limit across a boundary,
 * which is acceptable for abuse control.
 */
export async function consume(db: Db, policy: Policy, subject: string, now: Date = new Date()): Promise<Decision> {
  const at = now.toISOString();
  const windowSeconds = policy.windowMs / 1000;
  const rows = await db.execute<{ count: number; window_start: Date | string }>(sql`
    insert into rate_limit_buckets as b (key, window_start, count)
    values (${bucketKey(policy, subject)}, ${at}::timestamptz, 1)
    on conflict (key) do update set
      window_start = case when b.window_start + make_interval(secs => ${windowSeconds}) <= ${at}::timestamptz then ${at}::timestamptz else b.window_start end,
      count = case when b.window_start + make_interval(secs => ${windowSeconds}) <= ${at}::timestamptz then 1 else b.count + 1 end
    returning count, window_start`);
  const row = [...rows][0]!;
  const resetAt = new Date(row.window_start).getTime() + policy.windowMs;
  return {
    allowed: row.count <= policy.limit,
    count: row.count,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
  };
}

/** Clears a counter, e.g. an account's failed-login count after a successful login. */
export async function resetLimit(db: Db, policy: Policy, subject: string): Promise<void> {
  await db.execute(sql`delete from rate_limit_buckets where key = ${bucketKey(policy, subject)}`);
}

/** Drops counters whose window ended long ago. */
export async function purgeRateLimits(db: Db, now: Date = new Date(), olderThanMs = 2 * 60 * 60 * 1000): Promise<number> {
  const removed = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStart, new Date(now.getTime() - olderThanMs)))
    .returning({ key: rateLimitBuckets.key });
  return removed.length;
}

export function tooManyRequests(retryAfterSeconds: number) {
  const err = apiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
  err.output.headers['Retry-After'] = String(retryAfterSeconds);
  return err;
}
