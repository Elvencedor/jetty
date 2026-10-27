import type { Request, ResponseObject, ResponseToolkit, ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { apiError } from '../../../lib/errors.js';
import { LIMITS } from '../../../lib/rate-policies.js';
import { ADMIN_SESSION_TTL_MS, login, logout, refresh, type AdminSession } from '../../../modules/admin/auth.js';
import { ANY_ADMIN } from '../../../plugins/admin-auth.js';
import { clientIp, enforce } from '../../../plugins/rate-limit.js';
import { db, NO_STORE } from '../shared.js';

export const ADMIN_REFRESH_COOKIE = 'jh_admin_refresh';
const COOKIE_PATH = '/api/v1/admin/auth';

function secret(request: Request): string {
  const value = request.server.app.env.AUTH_TOKEN_SECRET;
  if (!value) throw apiError(503, 'AUTH_UNAVAILABLE', 'Sign-in is temporarily unavailable.');
  return value;
}

function assertTrustedOrigin(request: Request): void {
  const origin = request.headers.origin as string | undefined;
  if (origin && !request.server.app.env.corsOrigins.includes(origin)) throw apiError(403, 'FORBIDDEN', 'This origin is not allowed.');
}

const setRefreshCookie = (response: ResponseObject, token: string) =>
  response.state(ADMIN_REFRESH_COOKIE, token, { isSecure: true, isHttpOnly: true, isSameSite: 'Strict', path: COOKIE_PATH, ttl: ADMIN_SESSION_TTL_MS, encoding: 'none' });

function sessionResponse(h: ResponseToolkit, session: AdminSession) {
  const { refreshToken, ...body } = session;
  const response = h.response({ ...body, tokenType: 'Bearer' }).header('Cache-Control', NO_STORE);
  setRefreshCookie(response, refreshToken);
  return response;
}

export const adminAuthRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/admin/auth/login',
    options: {
      auth: false,
      // Credential checks fail closed: if the limiter cannot be reached, sign-in pauses rather than allowing unlimited guessing.
      plugins: { rateLimit: { ip: [LIMITS.adminLogin], failClosed: true } },
      description: 'Admin sign-in with email and password',
      tags: ['api', 'admin'],
      validate: { payload: Joi.object({ email: Joi.string().trim().lowercase().email().max(254).required(), password: Joi.string().min(1).max(128).required() }) },
    },
    handler: async (request, h) => {
      const input = request.payload as { email: string; password: string };
      // Keyed by email and IP: an outsider cannot use up the real admin's attempts from another address.
      const subject = `${input.email}|${clientIp(request, request.server.app.env.TRUSTED_PROXY_HOPS)}`;
      await enforce(request, LIMITS.adminLoginAccount, subject, { failClosed: true });
      const session = await login(db(request), secret(request), input);
      await request.server.app.rateLimiter?.reset(LIMITS.adminLoginAccount, subject).catch(() => undefined);
      return sessionResponse(h, session);
    },
  },
  {
    method: 'POST',
    path: '/admin/auth/refresh',
    options: { auth: false, plugins: { rateLimit: { ip: [LIMITS.refresh] } }, description: 'Rotate the admin refresh cookie', tags: ['api', 'admin'] },
    handler: async (request, h) => {
      assertTrustedOrigin(request);
      const presented = request.state[ADMIN_REFRESH_COOKIE];
      if (typeof presented !== 'string') throw apiError(401, 'INVALID_REFRESH_TOKEN', 'Your session has expired. Please sign in again.');
      return sessionResponse(h, await refresh(db(request), secret(request), presented));
    },
  },
  {
    method: 'POST',
    path: '/admin/auth/logout',
    options: { auth: 'admin', plugins: { permission: [ANY_ADMIN] }, description: 'Revoke the current admin session', tags: ['api', 'admin'] },
    handler: async (request, h) => {
      assertTrustedOrigin(request);
      await logout(db(request), request.auth.credentials.adminSessionId!);
      return h.response().code(204).unstate(ADMIN_REFRESH_COOKIE, { path: COOKIE_PATH }).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/admin/me',
    options: { auth: 'admin', plugins: { permission: [ANY_ADMIN] }, description: 'Current admin, roles and permissions', tags: ['api', 'admin'] },
    handler: (request, h) => h.response(request.auth.credentials.admin).header('Cache-Control', NO_STORE),
  },
];
