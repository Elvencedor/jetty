import Hapi, { type Server } from '@hapi/hapi';
import type { Env } from './config/env.js';
import type { Database } from './db/client.js';
import type { RateLimiter } from './lib/rate-limit.js';
import type { PaymentProvider } from './modules/payments/provider.js';
import { createLogger, type Logger } from './lib/logger.js';
import { errorEnvelope } from './plugins/error-envelope.js';
import { customerAuth } from './plugins/customer-auth.js';
import { rateLimit } from './plugins/rate-limit.js';
import { requestContext } from './plugins/request-context.js';
import { healthRoutes, v1Routes } from './routes/index.js';

export const API_PREFIX = '/api/v1';

export type CreateServerOptions = {
  env: Env;
  logger?: Logger;
  /** Omit in tests that do not need PostgreSQL; readiness then skips the database check. */
  database?: Database;
  /** Omit to leave checkout disabled (503). Tests inject a fake. */
  payments?: PaymentProvider;
  /** Redis-backed limiter; required for limits to apply when RATE_LIMIT_ENABLED is true. */
  rateLimiter?: RateLimiter;
};

/**
 * Builds a fully configured, unstarted server. Tests call this and use
 * `server.inject(...)` without binding a port.
 */
export async function createServer({ env, logger, database, payments, rateLimiter }: CreateServerOptions): Promise<Server> {
  const log = logger ?? createLogger(env.LOG_LEVEL, { service: 'api' });

  const server = Hapi.server({
    host: env.HOST,
    port: env.PORT,
    routes: {
      cors: {
        origin: env.corsOrigins,
        credentials: true,
      },
      // Reject unknown query/payload keys rather than silently ignoring them.
      validate: {
        options: { abortEarly: false, stripUnknown: false },
        failAction: (_request, _h, err) => {
          throw err;
        },
      },
      payload: {
        maxBytes: 1_048_576,
      },
    },
  });

  server.app.env = env;
  server.app.logger = log;
  if (database) server.app.database = database;
  if (rateLimiter) server.app.rateLimiter = rateLimiter;
  if (payments) server.app.payments = payments;

  await server.register(requestContext(log));
  await server.register(rateLimit());
  await server.register(customerAuth());
  await server.register(errorEnvelope({ isProduction: env.isProduction }));

  server.route(healthRoutes);
  server.route(v1Routes.map((route) => ({ ...route, path: `${API_PREFIX}${route.path}` })));

  return server;
}

declare module '@hapi/hapi' {
  interface ServerApplicationState {
    env: Env;
    logger: Logger;
    database?: Database;
    payments?: PaymentProvider;
    rateLimiter?: RateLimiter;
  }
}
