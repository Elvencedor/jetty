import Boom from '@hapi/boom';
import type { Plugin } from '@hapi/hapi';
import { verifyAccessToken } from '../lib/tokens.js';
import { activeSession } from '../modules/auth/customers.js';

export type CustomerCredentials = { customerId: string; sessionId: string };

declare module '@hapi/hapi' {
  interface AuthCredentials {
    customerId?: string;
    sessionId?: string;
  }
}

/**
 * Bearer-token auth for customers. Routes use `mode: 'optional'` where guests
 * are allowed (no header passes; a bad or revoked token is a 401 rather than
 * silently downgrading the shopper to a guest) and `mode: 'required'` otherwise.
 * The session row is checked on every request so logout takes effect at once.
 */
export function customerAuth(): Plugin<void> {
  return {
    name: 'jetty-customer-auth',
    register(server) {
      server.auth.scheme('customer-bearer', () => ({
        authenticate: async (request, h) => {
          const header = request.headers.authorization as string | undefined;
          if (!header) throw Boom.unauthorized(null, 'Bearer');
          const secret = request.server.app.env.AUTH_TOKEN_SECRET;
          const token = /^Bearer ([\w.-]+)$/.exec(header)?.[1];
          const claims = secret && token ? verifyAccessToken(token, secret) : null;
          const database = request.server.app.database;
          const customer = claims && database ? await activeSession(database.db, claims.sid, claims.sub) : null;
          if (!claims || !customer) {
            const err = Boom.unauthorized('Authentication is required.', 'Bearer');
            err.data = { code: 'UNAUTHENTICATED' };
            throw err;
          }
          return h.authenticated({ credentials: { customerId: customer.id, sessionId: claims.sid } });
        },
      }));
      server.auth.strategy('customer', 'customer-bearer');
    },
  };
}
