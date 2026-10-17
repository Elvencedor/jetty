import { createHash } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { idempotencyKeys } from '../db/schema/index.js';
import { conflict } from './errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;
/**
 * A request that has not completed after this long died mid-flight (a crash or
 * 5xx), so its key is reaped. Any order it created is unpaid and expires with
 * its stock reservation, so a retry cannot double-charge.
 */
export const IN_FLIGHT_TIMEOUT_MS = 15 * 60 * 1000;

const reapable = (now: Date) =>
  or(lt(idempotencyKeys.expiresAt, now), and(isNull(idempotencyKeys.responseStatus), lt(idempotencyKeys.createdAt, new Date(now.getTime() - IN_FLIGHT_TIMEOUT_MS))));

/** Deterministic JSON so logically equal payloads hash identically. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const hashRequest = (payload: unknown) => createHash('sha256').update(canonical(payload)).digest('hex');

export type IdempotencyStart =
  | { kind: 'new'; id: string }
  | { kind: 'replay'; status: number; body: unknown };

/**
 * Claims (scope, key). A repeat with the same request hash replays the stored
 * response; a different payload is a 409 conflict; a request still in flight
 * is a 409 as well, so the same key can never create two orders.
 */
export async function beginIdempotent(
  db: Db,
  input: { scope: string; key: string; requestHash: string; now?: Date },
): Promise<IdempotencyStart> {
  const now = input.now ?? new Date();
  await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, input.scope), eq(idempotencyKeys.key, input.key), reapable(now)));

  const [created] = await db
    .insert(idempotencyKeys)
    .values({ scope: input.scope, key: input.key, requestHash: input.requestHash, expiresAt: new Date(now.getTime() + TTL_MS) })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  if (created) return { kind: 'new', id: created.id };

  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, input.scope), eq(idempotencyKeys.key, input.key)));
  if (!existing) return beginIdempotent(db, input);
  if (existing.requestHash !== input.requestHash) {
    throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
  }
  if (existing.responseStatus === null) {
    throw conflict('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed.');
  }
  return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
}

export async function completeIdempotent(db: Db, id: string, status: number, body: unknown): Promise<void> {
  await db.update(idempotencyKeys).set({ responseStatus: status, responseBody: body as object }).where(eq(idempotencyKeys.id, id));
}

/** Frees the key after a failure that created nothing, so the client can retry a corrected request. */
export async function abandonIdempotent(db: Db, id: string): Promise<void> {
  await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
}

/** Deletes expired keys and abandoned in-flight claims. Safe to run concurrently. Returns the number removed. */
export async function cleanupIdempotencyKeys(db: Db, now: Date = new Date()): Promise<number> {
  const removed = await db.delete(idempotencyKeys).where(reapable(now)).returning({ id: idempotencyKeys.id });
  return removed.length;
}
