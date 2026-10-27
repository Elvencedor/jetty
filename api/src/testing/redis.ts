import { randomBytes } from 'node:crypto';
import { createRedisRateLimiter, type RateLimiter } from '../lib/rate-limit.js';

/** Redis-backed tests run only when TEST_REDIS_URL points at a disposable Redis. */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

/** A limiter on a random key prefix, so parallel files and repeated runs never share counters. */
export async function createTestRateLimiter(): Promise<RateLimiter> {
  if (!TEST_REDIS_URL) throw new Error('TEST_REDIS_URL is not set');
  return createRedisRateLimiter(TEST_REDIS_URL, { prefix: `test:${randomBytes(6).toString('hex')}:` });
}
