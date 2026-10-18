import { Redis } from 'ioredis';
import { apiError } from './errors.js';
import { sha256 } from './tokens.js';

export type Policy = { name: string; limit: number; windowMs: number };

export type Decision = { allowed: boolean; count: number; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one hit against `policy` for `subject`. */
  consume(policy: Policy, subject: string): Promise<Decision>;
  /** Clears a counter, e.g. an account's failed-login count after a successful login. */
  reset(policy: Policy, subject: string): Promise<void>;
  close(): Promise<void>;
}

// INCR and the expiry run in one script, so a crash can never leave a counter without a TTL and
// concurrent requests cannot slip past the limit. The window starts at the first hit and Redis
// expires the key when it ends. A fixed window allows up to twice the limit across a boundary.
const CONSUME = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export type RedisRateLimiterOptions = {
  /** Namespaces keys; tests use a random one so runs never share counters. */
  prefix?: string;
  /** Upper bound on any command; the caller fails open past it. */
  commandTimeoutMs?: number;
};

/** Subjects (IPs, phone numbers, order numbers) are hashed so Redis never holds raw identifiers. */
const bucketKey = (prefix: string, policy: Policy, subject: string) => `${prefix}${policy.name}:${sha256(subject.trim().toLowerCase())}`;

/** Connects eagerly so a wrong REDIS_URL stops the service at startup instead of silently disabling limits. */
export async function createRedisRateLimiter(url: string, { prefix = 'rl:', commandTimeoutMs = 250 }: RedisRateLimiterOptions = {}): Promise<RateLimiter> {
  const redis = new Redis(url, {
    lazyConnect: true,
    commandTimeout: commandTimeoutMs,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    // Fail fast while disconnected rather than queueing requests behind the limiter.
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });
  // Without a listener ioredis would throw on connection errors; failures surface per command instead.
  redis.on('error', () => undefined);
  await redis.connect();

  return {
    async consume(policy, subject) {
      const [count, ttl] = (await redis.eval(CONSUME, 1, bucketKey(prefix, policy, subject), String(policy.windowMs))) as [number, number];
      return { allowed: count <= policy.limit, count, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
    },
    async reset(policy, subject) {
      await redis.del(bucketKey(prefix, policy, subject));
    },
    async close() {
      redis.disconnect();
    },
  };
}

export function tooManyRequests(retryAfterSeconds: number) {
  const err = apiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
  err.output.headers['Retry-After'] = String(retryAfterSeconds);
  return err;
}
