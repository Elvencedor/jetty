import type { Request, ResponseObject, ResponseToolkit, ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { apiError } from '../../lib/errors.js';
import { customers } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { enforce } from '../../plugins/rate-limit.js';
import { LIMITS } from '../../lib/rate-policies.js';
import { CODE_TTL_MS, RESEND_COOLDOWN_MS } from '../../modules/auth/challenges.js';
import {
  logout,
  profile,
  refresh,
  REFRESH_TOKEN_TTL_MS,
  register,
  login,
  requestPasswordReset,
  resetPassword,
  type Issued,
} from '../../modules/auth/customers.js';
import { db, NO_STORE } from './shared.js';

export const REFRESH_COOKIE = 'jh_refresh';
function secret(request: Request): string {
  const value = request.server.app.env.AUTH_TOKEN_SECRET;
  if (!value) throw apiError(503, 'AUTH_UNAVAILABLE', 'Sign-in is temporarily unavailable.');
  return value;
}

/** Cookie-authenticated state changes must come from an allowed browser origin (CSRF defence on top of SameSite=Strict). */
function assertTrustedOrigin(request: Request): void {
  const origin = request.headers.origin as string | undefined;
  if (origin && !request.server.app.env.corsOrigins.includes(origin)) {
    throw apiError(403, 'FORBIDDEN', 'This origin is not allowed.');
  }
}

const setRefreshCookie = (response: ResponseObject, token: string) =>
  response.state(REFRESH_COOKIE, token, {
    isSecure: true,
    isHttpOnly: true,
    isSameSite: 'Strict',
    path: '/api/v1/auth',
    ttl: REFRESH_TOKEN_TTL_MS,
    encoding: 'none',
  });

function sessionResponse(h: ResponseToolkit, issued: Issued, status = 200) {
  const response = h
    .response({ accessToken: issued.accessToken, tokenType: 'Bearer', expiresIn: issued.expiresIn, customer: issued.customer })
    .code(status)
    .header('Cache-Control', NO_STORE);
  setRefreshCookie(response, issued.refreshToken);
  return response;
}

const phone = Joi.string()
  .trim()
  .pattern(/^\+[1-9]\d{7,14}$/)
  .messages({ 'string.pattern.base': 'phone must be in E.164 format, e.g. +2348012345678' });
const email = Joi.string().trim().lowercase().email().max(254);
const password = Joi.string().min(10).max(128).required();
const code = Joi.string().trim().pattern(/^\d{6}$/).required().messages({ 'string.pattern.base': 'code must be the 6-digit code you received' });

// Same body whether or not the account exists, so these endpoints reveal nothing.
const codeSent = (h: ResponseToolkit) =>
  h
    .response({ expiresInSeconds: CODE_TTL_MS / 1000, resendAfterSeconds: RESEND_COOLDOWN_MS / 1000 })
    .code(202)
    .header('Cache-Control', NO_STORE);

export const authRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/auth/register',
    options: {
      auth: false,
      description: 'Create a customer account with an email and password (phone optional) and start a session',
      plugins: { rateLimit: { ip: [LIMITS.register] } },
      tags: ['api', 'auth'],
      validate: {
        payload: Joi.object({ email: email.required(), password, phone }),
      },
    },
    handler: async (request, h) => sessionResponse(h, await register(db(request), secret(request), request.payload as { email: string; password: string; phone?: string }), 201),
  },
  {
    method: 'POST',
    path: '/auth/login',
    options: {
      auth: false,
      description: 'Email and password login; credential failures are indistinguishable',
      plugins: { rateLimit: { ip: [LIMITS.login] } },
      tags: ['api', 'auth'],
      validate: {
        payload: Joi.object({ email: email.required(), password: Joi.string().min(1).max(128).required() }),
      },
    },
    handler: async (request, h) => {
      const credentials = request.payload as { email: string; password: string };
      const subject = credentials.email;
      // Failed attempts per account are capped across all IPs; the counter is cleared on success.
      await enforce(request, LIMITS.loginAccount, subject);
      const issued = await login(db(request), secret(request), credentials);
      await request.server.app.rateLimiter?.reset(LIMITS.loginAccount, subject).catch(() => undefined);
      return sessionResponse(h, issued);
    },
  },
  {
    method: 'POST',
    path: '/auth/password/forgot',
    options: {
      auth: false,
      description: 'Send a password reset code to the account email; the response never reveals whether the account exists',
      plugins: { rateLimit: { ip: [LIMITS.passwordForgot] } },
      tags: ['api', 'auth'],
      validate: { payload: Joi.object({ email: email.required() }) },
    },
    handler: async (request, h) => {
      const input = request.payload as { email: string };
      await enforce(request, LIMITS.passwordForgotAccount, input.email);
      await requestPasswordReset(db(request), secret(request), input);
      return codeSent(h);
    },
  },
  {
    method: 'POST',
    path: '/auth/password/reset',
    options: {
      auth: false,
      description: 'Set a new password with a reset code; ends every session of the account',
      plugins: { rateLimit: { ip: [LIMITS.passwordReset] } },
      tags: ['api', 'auth'],
      validate: { payload: Joi.object({ email: email.required(), code, password }) },
    },
    handler: async (request, h) => {
      const input = request.payload as { email: string; code: string; password: string };
      await enforce(request, LIMITS.passwordResetAccount, input.email);
      await resetPassword(db(request), secret(request), input);
      return h.response().code(204).unstate(REFRESH_COOKIE, { path: '/api/v1/auth' }).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'POST',
    path: '/auth/refresh',
    options: {
      auth: false,
      description: 'Rotate the refresh cookie and issue a new access token',
      plugins: { rateLimit: { ip: [LIMITS.refresh] } },
      tags: ['api', 'auth'],
    },
    handler: async (request, h) => {
      assertTrustedOrigin(request);
      const presented = request.state[REFRESH_COOKIE];
      if (typeof presented !== 'string') throw apiError(401, 'INVALID_REFRESH_TOKEN', 'Your session has expired. Please sign in again.');
      try {
        return sessionResponse(h, await refresh(db(request), secret(request), presented));
      } catch (err) {
        // A dead refresh token should not be sent again.
        if ((err as { data?: { code?: string } }).data?.code === 'INVALID_REFRESH_TOKEN') {
          (err as { output: { headers: Record<string, string> } }).output.headers['set-cookie'] =
            `${REFRESH_COOKIE}=; Max-Age=0; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Strict`;
        }
        throw err;
      }
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    options: {
      auth: { strategy: 'customer', mode: 'required' },
      description: 'Revoke the current session',
      tags: ['api', 'auth'],
    },
    handler: async (request, h) => {
      assertTrustedOrigin(request);
      await logout(db(request), request.auth.credentials.sessionId!);
      return h.response().code(204).unstate(REFRESH_COOKIE, { path: '/api/v1/auth' }).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/me',
    options: {
      auth: { strategy: 'customer', mode: 'required' },
      description: 'Current customer profile',
      tags: ['api', 'me'],
    },
    handler: async (request, h) => {
      const [customer] = await db(request).select().from(customers).where(eq(customers.id, request.auth.credentials.customerId!));
      return h.response(profile(customer!)).header('Cache-Control', NO_STORE);
    },
  },
];
