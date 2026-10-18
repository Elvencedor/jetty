import type { Db } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import { cleanupIdempotencyKeys } from '../lib/idempotency.js';
import { releaseExpiredReservations } from '../modules/inventory/reservations.js';

/**
 * One maintenance pass. Each task is isolated so a failure in one never
 * blocks the others, and every task is idempotent and safe across replicas.
 */
export async function runMaintenance(db: Db, logger: Logger, now: Date = new Date()) {
  const result = { reservationsReleased: 0, idempotencyKeysRemoved: 0, failed: [] as string[] };
  const tasks: [string, () => Promise<void>][] = [
    ['release-expired-reservations', async () => void (result.reservationsReleased = await releaseExpiredReservations(db, now))],
    ['cleanup-idempotency-keys', async () => void (result.idempotencyKeysRemoved = await cleanupIdempotencyKeys(db, now))],
  ];
  for (const [name, task] of tasks) {
    try {
      await task();
    } catch (err) {
      result.failed.push(name);
      logger.error('maintenance task failed', { task: name, err: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.reservationsReleased || result.idempotencyKeysRemoved) logger.info('maintenance pass', result);
  return result;
}
