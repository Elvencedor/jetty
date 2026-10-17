import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { runMaintenance } from './maintenance.js';

const INTERVAL_MS = 60_000;

/** Background worker entry point: `npm run start:worker`. */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, { service: 'worker', env: env.NODE_ENV });
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for the worker');
  const database = createDatabase(env.DATABASE_URL, { max: 2 });

  let stopping = false;
  let running: Promise<unknown> = Promise.resolve();
  const tick = () => {
    if (stopping) return;
    running = runMaintenance(database.db, logger).catch((err: unknown) =>
      logger.error('maintenance pass crashed', { err: err instanceof Error ? err.message : String(err) }),
    );
  };
  const timer = setInterval(tick, INTERVAL_MS);
  tick();
  logger.info('worker started', { intervalMs: INTERVAL_MS });

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    clearInterval(timer);
    await running;
    await database.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown(signal));
}

main().catch((err: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', time: new Date().toISOString(), msg: 'worker failed to start', err: err instanceof Error ? err.message : String(err) })}\n`);
  process.exit(1);
});
