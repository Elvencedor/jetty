import type { Plugin, Request } from '@hapi/hapi';
import { consume, tooManyRequests, type Policy } from '../lib/rate-limit.js';

declare module '@hapi/hapi' {
  interface PluginSpecificConfiguration {
    /** Per-IP policies applied before authentication and payload parsing. */
    rateLimit?: { ip: Policy[] };
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

/** Throws 429 when `subject` has exhausted `policy`. A broken limiter never blocks traffic that would otherwise succeed. */
export async function enforce(request: Request, policy: Policy, subject: string): Promise<void> {
  const { env, database } = request.server.app;
  if (!env.RATE_LIMIT_ENABLED || !database) return;
  let decision;
  try {
    decision = await consume(database.db, policy, subject);
  } catch (err) {
    request.app.logger?.error('rate limiter unavailable', { policy: policy.name, err: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!decision.allowed) {
    request.app.logger?.warn('rate limited', { policy: policy.name });
    throw tooManyRequests(decision.retryAfterSeconds);
  }
}

export const enforceIp = (request: Request, policy: Policy) => enforce(request, policy, clientIp(request, request.server.app.env.TRUSTED_PROXY_HOPS));

export function rateLimit(): Plugin<void> {
  return {
    name: 'jetty-rate-limit',
    register(server) {
      // Before auth and body parsing, so rejected callers cost almost nothing (no scrypt, no payload work).
      server.ext('onPreAuth', async (request, h) => {
        for (const policy of request.route.settings.plugins?.rateLimit?.ip ?? []) await enforceIp(request, policy);
        return h.continue;
      });
    },
  };
}
