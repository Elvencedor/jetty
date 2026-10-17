import Hapi, { type Server } from '@hapi/hapi';
import type { Env } from '../config/env.js';
import type { Database } from '../db/client.js';
import { createLogger, type Logger } from '../lib/logger.js';
import type { PaymentProvider } from '../modules/payments/provider.js';
import { errorEnvelope } from '../plugins/error-envelope.js';
import { requestContext } from '../plugins/request-context.js';
import { healthRoutes } from '../routes/health.js';
import { handlePaystackEvent } from './process.js';
import { verifyPaystackSignature } from './signature.js';

/** Paystack events are small; anything larger is not a legitimate delivery. */
const MAX_WEBHOOK_BYTES = 64 * 1024;

export type CreateWebhookServerOptions = {
  env: Env;
  database: Database;
  payments: PaymentProvider;
  /** HMAC key for x-paystack-signature. */
  signingSecret: string;
  logger?: Logger;
};

/**
 * The payment-webhook service. It is deliberately a separate server (and
 * process) from the public API: it exposes only the webhook and health routes,
 * has no CORS or browser surface, and can be scaled, rate-limited and
 * firewalled independently so webhook traffic can never starve checkout and
 * vice versa. It shares the database and settlement code with the API.
 */
export async function createWebhookServer({ env, database, payments, signingSecret, logger }: CreateWebhookServerOptions): Promise<Server> {
  const log = logger ?? createLogger(env.LOG_LEVEL, { service: 'webhooks' });

  const server = Hapi.server({
    host: env.HOST,
    port: env.WEBHOOK_PORT ?? env.PORT,
  });
  server.app.env = env;
  server.app.logger = log;
  server.app.database = database;

  await server.register(requestContext(log));
  await server.register(errorEnvelope({ isProduction: env.isProduction }));

  server.route(healthRoutes);
  server.route({
    method: 'POST',
    path: '/webhooks/paystack',
    options: {
      auth: false,
      description: 'Signed Paystack events; verified server-to-server before any state change',
      tags: ['webhooks'],
      // The signature covers the exact bytes Paystack sent, so the body must not be parsed first.
      payload: { parse: false, output: 'data', maxBytes: MAX_WEBHOOK_BYTES },
    },
    handler: async (request, h) => {
      const raw = request.payload as Buffer;
      const requestId = request.app.requestId;
      const signature = request.headers['x-paystack-signature'];
      if (!verifyPaystackSignature(raw, typeof signature === 'string' ? signature : undefined, signingSecret)) {
        request.app.logger.warn('webhook signature rejected');
        return h.response({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature.', requestId } }).code(401);
      }

      const result = await handlePaystackEvent(database.db, payments, raw);
      if (result.status === 200) return h.response({ received: true, outcome: result.outcome }).code(200);
      if (result.status === 400) return h.response({ error: { code: 'BAD_REQUEST', message: 'Malformed event.', requestId } }).code(400);
      return h.response({ error: { code: 'VERIFICATION_UNAVAILABLE', message: 'Try again.', requestId } }).code(503);
    },
  });

  return server;
}
