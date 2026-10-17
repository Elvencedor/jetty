import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createDatabase } from './db/client.js';
import { PaystackProvider } from './modules/payments/paystack.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, { service: 'api', env: env.NODE_ENV });
  const database = env.DATABASE_URL ? createDatabase(env.DATABASE_URL) : undefined;
  const payments = env.PAYSTACK_SECRET_KEY
    ? new PaystackProvider({ secretKey: env.PAYSTACK_SECRET_KEY, baseUrl: env.PAYSTACK_BASE_URL })
    : undefined;
  const server = await createServer({ env, logger, database, payments });

  // Railway replaces instances at will, so shut down cleanly rather than
  // dropping in-flight requests.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    try {
      await server.stop({ timeout: 10_000 });
      await database?.close();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('shutdown failed', { err: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', {
      err: reason instanceof Error ? reason.message : String(reason),
    });
    void shutdown('unhandledRejection');
  });

  await server.start();
  logger.info('api listening', { uri: server.info.uri });
}

main().catch((err: unknown) => {
  // The logger may not exist yet (bad env, failed plugin registration).
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      time: new Date().toISOString(),
      msg: 'api failed to start',
      err: err instanceof Error ? err.message : String(err),
    })}\n`,
  );
  process.exit(1);
});
