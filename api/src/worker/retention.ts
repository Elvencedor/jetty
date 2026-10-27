import { and, eq, isNotNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { adminSessions, analyticsEvents, customerSessions, notificationOutbox } from '../db/schema/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long finished rows are kept. Anything still needed for a decision (pending messages, live sessions) is never touched. */
export const RETENTION = {
  /** Expired or revoked sessions linger briefly so a reused refresh token can still be recognised as a replay. */
  sessionsDays: 7,
  sentMessagesDays: 14,
  failedMessagesDays: 30,
  analyticsEventsDays: 90,
} as const;

const before = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

export async function cleanupSessions(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = before(now, RETENTION.sessionsDays);
  const gone = (t: typeof customerSessions | typeof adminSessions) => or(lt(t.expiresAt, cutoff), and(isNotNull(t.revokedAt), lt(t.revokedAt, cutoff)));
  const [customers, admins] = await Promise.all([
    db.delete(customerSessions).where(gone(customerSessions)).returning({ id: customerSessions.id }),
    db.delete(adminSessions).where(gone(adminSessions)).returning({ id: adminSessions.id }),
  ]);
  return customers.length + admins.length;
}

/** Delivered messages are history, not state: they are kept briefly for support questions, then dropped. */
export async function cleanupOutbox(db: Db, now: Date = new Date()): Promise<number> {
  const removed = await db
    .delete(notificationOutbox)
    .where(
      or(
        and(eq(notificationOutbox.status, 'sent'), lt(notificationOutbox.sentAt, before(now, RETENTION.sentMessagesDays))),
        and(eq(notificationOutbox.status, 'failed'), lt(notificationOutbox.createdAt, before(now, RETENTION.failedMessagesDays))),
      ),
    )
    .returning({ id: notificationOutbox.id });
  return removed.length;
}

export async function cleanupAnalyticsEvents(db: Db, now: Date = new Date()): Promise<number> {
  const removed = await db.delete(analyticsEvents).where(lt(analyticsEvents.occurredAt, before(now, RETENTION.analyticsEventsDays))).returning({ id: analyticsEvents.id });
  return removed.length;
}
