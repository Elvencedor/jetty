import { and, eq, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { promotions } from '../db/schema/index.js';
import type { Logger } from '../lib/logger.js';
import { cleanupIdempotencyKeys } from '../lib/idempotency.js';
import { cleanupChallenges, scrubStaleCodes } from '../modules/auth/challenges.js';
import { releaseExpiredReservations } from '../modules/inventory/reservations.js';
import { cleanupAnalyticsEvents, cleanupOutbox, cleanupSessions } from './retention.js';

/**
 * One maintenance pass. Each task is isolated so a failure in one never
 * blocks the others, and every task is idempotent and safe across replicas.
 */
export async function runMaintenance(db: Db, logger: Logger, now: Date = new Date()) {
  const result = { reservationsReleased: 0, idempotencyKeysRemoved: 0, authChallengesRemoved: 0, staleCodesScrubbed: 0, promotionsExpired: 0, sessionsRemoved: 0, messagesRemoved: 0, analyticsEventsRemoved: 0, failed: [] as string[] };
  const tasks: [string, () => Promise<void>][] = [
    ['release-expired-reservations', async () => void (result.reservationsReleased = await releaseExpiredReservations(db, now))],
    ['cleanup-idempotency-keys', async () => void (result.idempotencyKeysRemoved = await cleanupIdempotencyKeys(db, now))],
    ['cleanup-auth-challenges', async () => void (result.authChallengesRemoved = await cleanupChallenges(db, now))],
    ['scrub-stale-codes', async () => void (result.staleCodesScrubbed = await scrubStaleCodes(db, now))],
    ['cleanup-sessions', async () => void (result.sessionsRemoved = await cleanupSessions(db, now))],
    ['cleanup-notification-outbox', async () => void (result.messagesRemoved = await cleanupOutbox(db, now))],
    ['cleanup-analytics-events', async () => void (result.analyticsEventsRemoved = await cleanupAnalyticsEvents(db, now))],
    // The schedule is enforced at quote time regardless; this only keeps the stored status honest for reporting.
    [
      'expire-promotions',
      async () => {
        const ended = await db.update(promotions).set({ status: 'expired' }).where(and(eq(promotions.status, 'active'), isNotNull(promotions.endsAt), lte(promotions.endsAt, now))).returning({ id: promotions.id });
        result.promotionsExpired = ended.length;
      },
    ],
  ];
  for (const [name, task] of tasks) {
    try {
      await task();
    } catch (err) {
      result.failed.push(name);
      logger.error('maintenance task failed', { task: name, err: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.reservationsReleased || result.idempotencyKeysRemoved || result.authChallengesRemoved || result.staleCodesScrubbed || result.promotionsExpired || result.sessionsRemoved || result.messagesRemoved || result.analyticsEventsRemoved) logger.info('maintenance pass', result);
  return result;
}
