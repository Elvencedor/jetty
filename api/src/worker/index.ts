import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { createSenders } from '../modules/notifications/providers.js';
import { oldestPendingSeconds, processOutbox } from '../modules/notifications/process.js';
import { runMaintenance } from './maintenance.js';

const INTERVAL_MS = 60_000;
const OUTBOX_INTERVAL_MS = 5_000;
/** Undelivered messages older than this are worth an alert; one-time codes are useless after ten minutes. */
const BACKLOG_ALERT_SECONDS = 300;

/** Background worker entry point: `npm run start:worker`. */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, { service: 'worker', env: env.NODE_ENV });
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for the worker');
  const database = createDatabase(env.DATABASE_URL, { max: 3 });
  const senders = createSenders(env, logger);

  let stopping = false;
  let running: Promise<unknown> = Promise.resolve();
  let sending: Promise<unknown> = Promise.resolve();
  const tick = () => {
    if (stopping) return;
    running = runMaintenance(database.db, logger).catch((err: unknown) =>
      logger.error('maintenance pass crashed', { err: err instanceof Error ? err.message : String(err) }),
    );
  };
  let outboxRunning = false;
  const sendNotifications = () => {
    // A slow provider must not stack passes on top of each other.
    if (stopping || outboxRunning) return;
    outboxRunning = true;
    sending = processOutbox(database.db, senders, logger)
      .then(async (result) => {
        if (result.sent || result.retried || result.failed) logger.info('outbox pass', result);
        const waiting = await oldestPendingSeconds(database.db);
        if (waiting > BACKLOG_ALERT_SECONDS) logger.error('notification backlog', { oldestPendingSeconds: waiting });
      })
      .catch((err: unknown) => logger.error('outbox pass crashed', { err: err instanceof Error ? err.message : String(err) }))
      .finally(() => void (outboxRunning = false));
  };
  const timer = setInterval(tick, INTERVAL_MS);
  const outboxTimer = setInterval(sendNotifications, OUTBOX_INTERVAL_MS);
  tick();
  sendNotifications();
  logger.info('worker started', { intervalMs: INTERVAL_MS, outboxIntervalMs: OUTBOX_INTERVAL_MS, sms: senders.sms.name, email: senders.email.name });

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    clearInterval(timer);
    clearInterval(outboxTimer);
    await Promise.all([running, sending]);
    await database.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown(signal));
}

main().catch((err: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', time: new Date().toISOString(), msg: 'worker failed to start', err: err instanceof Error ? err.message : String(err) })}\n`);
  process.exit(1);
});
