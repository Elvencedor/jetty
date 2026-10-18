import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { PaystackProvider } from '../modules/payments/paystack.js';
import { createRedisRateLimiter } from '../lib/rate-limit.js';
import { createWebhookServer } from './server.js';

/** Entry point of the standalone webhook service: `npm run start:webhook`. */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, { service: 'webhooks', env: env.NODE_ENV });
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for the webhook service');
  if (!env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is required for the webhook service');

  const database = createDatabase(env.DATABASE_URL, { max: 5 });
  const payments = new PaystackProvider({ secretKey: env.PAYSTACK_SECRET_KEY, baseUrl: env.PAYSTACK_BASE_URL });
  const rateLimiter = env.RATE_LIMIT_ENABLED && env.REDIS_URL ? await createRedisRateLimiter(env.REDIS_URL) : undefined;
  const server = await createWebhookServer({
    env,
    database,
    rateLimiter,
    payments,
    signingSecret: env.PAYSTACK_WEBHOOK_SECRET ?? env.PAYSTACK_SECRET_KEY,
    logger,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    try {
      await server.stop({ timeout: 10_000 });
      await database.close();
      await rateLimiter?.close();
      process.exit(0);
    } catch (err) {
      logger.error('shutdown failed', { err: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown(signal));

  await server.start();
  logger.info('webhook service listening', { uri: server.info.uri });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', time: new Date().toISOString(), msg: 'webhook service failed to start', err: err instanceof Error ? err.message : String(err) })}\n`,
  );
  process.exit(1);
});
