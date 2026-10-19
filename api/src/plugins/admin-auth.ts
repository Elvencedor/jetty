import Boom from '@hapi/boom';
import type { Plugin } from '@hapi/hapi';
import { activeAdminSession, permits, type AdminIdentity } from '../modules/admin/auth.js';

/** Marks a route open to any signed-in admin (profile, logout). */
export const ANY_ADMIN = '@any-admin';

declare module '@hapi/hapi' {
  interface AuthCredentials {
    adminId?: string;
    adminSessionId?: string;
    admin?: AdminIdentity;
  }
  interface PluginSpecificConfiguration {
    /** Any one of these permissions admits the caller (`x:write` implies `x:read`; `*` implies all). */
    permission?: string[];
  }
}

/**
 * Bearer auth for the admin portal plus declarative authorization: a route sets
 * `plugins.permission` and the check runs after authentication on every request.
 * A route that is authenticated but declares no permission is refused, so a
 * forgotten annotation fails closed instead of open.
 */
export function adminAuth(): Plugin<void> {
  return {
    name: 'jetty-admin-auth',
    register(server) {
      server.auth.scheme('admin-bearer', () => ({
        authenticate: async (request, h) => {
          const header = request.headers.authorization as string | undefined;
          if (!header) throw Boom.unauthorized(null, 'Bearer');
          const secret = request.server.app.env.AUTH_TOKEN_SECRET;
          const database = request.server.app.database;
          const token = /^Bearer ([\w.-]+)$/.exec(header)?.[1];
          const session = secret && database && token ? await activeAdminSession(database.db, secret, token) : null;
          if (!session) {
            const err = Boom.unauthorized('Authentication is required.', 'Bearer');
            err.data = { code: 'UNAUTHENTICATED' };
            throw err;
          }
          return h.authenticated({ credentials: { adminId: session.admin.id, adminSessionId: session.sessionId, admin: session.admin } });
        },
      }));
      server.auth.strategy('admin', 'admin-bearer');

      server.ext('onPostAuth', (request, h) => {
        if (request.auth.strategy !== 'admin') return h.continue;
        const needed = request.route.settings.plugins?.permission;
        const held = request.auth.credentials.admin?.permissions ?? [];
        if (!needed || !(needed.includes(ANY_ADMIN) || needed.some((p) => permits(held, p)))) {
          const err = Boom.forbidden('You do not have access to this resource.');
          err.data = { code: 'FORBIDDEN' };
          throw err;
        }
        return h.continue;
      });
    },
  };
}
