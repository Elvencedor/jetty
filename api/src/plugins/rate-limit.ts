import type { Plugin, Request } from '@hapi/hapi';
import { apiError } from '../lib/errors.js';
import { tooManyRequests, type Policy } from '../lib/rate-limit.js';

declare module '@hapi/hapi' {
  interface PluginSpecificConfiguration {
    /** Per-IP policies applied before authentication and payload parsing. */
    rateLimit?: { ip: Policy[]; failClosed?: boolean };
  }
}

/**
 * The caller's address. Behind proxies the client controls the left of
 * X-Forwarded-For, so only the entry added by our own outermost proxy
 * (`hops` from the right) is trusted; with no proxy the socket address is used.
 */
export function clientIp(request: Request, hops: number): string {
  if (hops > 0) {
    const forwarded = String(request.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const entry = forwarded[forwarded.length - hops];
    if (entry) return entry;
  }
  return request.info.remoteAddress;
}

/**
 * Throws 429 when `subject` has exhausted `policy`. By default a Redis outage never blocks traffic that would
 * otherwise succeed; `failClosed` is for credential checks, where no limit would mean unlimited guessing.
 */
export async function enforce(request: Request, policy: Policy, subject: string, options: { failClosed?: boolean } = {}): Promise<void> {
  const { env, rateLimiter } = request.server.app;
  if (!env.RATE_LIMIT_ENABLED || !rateLimiter) return;
  let decision;
  try {
    decision = await rateLimiter.consume(policy, subject);
  } catch (err) {
    request.app.logger?.error('rate limiter unavailable', { policy: policy.name, err: err instanceof Error ? err.message : String(err) });
    if (options.failClosed) throw apiError(503, 'SERVICE_UNAVAILABLE', 'Sign-in is temporarily unavailable. Please try again shortly.');
    return;
  }
  if (!decision.allowed) {
    request.app.logger?.warn('rate limited', { policy: policy.name });
    throw tooManyRequests(decision.retryAfterSeconds);
  }
}

export const enforceIp = (request: Request, policy: Policy, options: { failClosed?: boolean } = {}) =>
  enforce(request, policy, clientIp(request, request.server.app.env.TRUSTED_PROXY_HOPS), options);

export function rateLimit(): Plugin<void> {
  return {
    name: 'jetty-rate-limit',
    register(server) {
      // Before auth and body parsing, so rejected callers cost almost nothing (no scrypt, no payload work).
      server.ext('onPreAuth', async (request, h) => {
        const failClosed = request.route.settings.plugins?.rateLimit?.failClosed ?? false;
        for (const policy of request.route.settings.plugins?.rateLimit?.ip ?? []) await enforceIp(request, policy, { failClosed });
        return h.continue;
      });
    },
  };
}
