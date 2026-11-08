import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Boom from '@hapi/boom';
import Hapi, { type Request, type Server } from '@hapi/hapi';
import { loadEnv } from '../config/env.js';
import { apiError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import type { Decision, Policy, RateLimiter } from '../lib/rate-limit.js';
import { createServer } from '../server.js';
import { clientIp, enforce, rateLimit } from './rate-limit.js';
import { errorEnvelope } from './error-envelope.js';
import { requestContext } from './request-context.js';
import Joi from 'joi';

const env = (extra: Record<string, string> = {}) => loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error', ...extra });

type Envelope = { error: { code: string; message: string; requestId: string; details?: unknown[] } };

async function bare(options: { isProduction?: boolean } = {}): Promise<Server> {
  const server = Hapi.server();
  server.app.env = env();
  server.app.logger = createLogger('error');
  await server.register(requestContext(createLogger('error')));
  await server.register(errorEnvelope({ isProduction: options.isProduction ?? false }));
  return server;
}

describe('error envelope', () => {
  it('renders a domain error with its code, message, details and request id', async () => {
    const server = await bare();
    server.route({ method: 'GET', path: '/x', handler: () => { throw apiError(409, 'STOCK_CONFLICT', 'Out of stock.', [{ variantId: 'v' }]); } });
    const res = await server.inject('/x');
    const body = res.result as Envelope;
    assert.equal(res.statusCode, 409);
    assert.equal(body.error.code, 'STOCK_CONFLICT');
    assert.equal(body.error.message, 'Out of stock.');
    assert.deepEqual(body.error.details, [{ variantId: 'v' }]);
    assert.equal(res.headers['x-request-id'], body.error.requestId);
  });

  it('omits details when there are none', async () => {
    const server = await bare();
    server.route({ method: 'GET', path: '/x', handler: () => { throw apiError(404, 'NOT_FOUND', 'No.'); } });
    const { error } = (await server.inject('/x')).result as Envelope;
    assert.equal('details' in error, false);
  });

  it('turns route validation failures into a 422 VALIDATION_FAILED', async () => {
    const server = await bare();
    server.route({
      method: 'POST',
      path: '/x',
      options: { validate: { payload: Joi.object({ n: Joi.number().required() }), failAction: (_r, _h, err) => { throw err; } } },
      handler: () => 'ok',
    });
    const res = await server.inject({ method: 'POST', url: '/x', payload: { n: 'abc' } });
    assert.equal(res.statusCode, 422);
    assert.equal((res.result as Envelope).error.code, 'VALIDATION_FAILED');
  });

  it('maps plain Boom errors by status', async () => {
    const server = await bare();
    server.route({ method: 'GET', path: '/x', handler: () => { throw Boom.forbidden('nope'); } });
    const res = await server.inject('/x');
    assert.equal(res.statusCode, 403);
    assert.equal((res.result as Envelope).error.code, 'FORBIDDEN');
  });

  it('hides the cause of server errors from the client', async () => {
    const server = await bare({ isProduction: true });
    server.route({ method: 'GET', path: '/x', handler: () => { throw new Error('password=hunter2 at db.internal'); } });
    const res = await server.inject('/x');
    const body = res.result as Envelope;
    assert.equal(res.statusCode, 500);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(body.error.message, 'An unexpected error occurred.');
    assert.ok(!JSON.stringify(body).includes('hunter2'));
  });

  it('keeps headers set on the error, such as Retry-After', async () => {
    const server = await bare();
    server.route({ method: 'GET', path: '/x', handler: () => { const e = apiError(429, 'RATE_LIMITED', 'slow'); e.output.headers['Retry-After'] = '9'; throw e; } });
    assert.equal((await server.inject('/x')).headers['retry-after'], '9');
  });

  it('does not alter successful responses', async () => {
    const server = await bare();
    server.route({ method: 'GET', path: '/x', handler: () => ({ data: 1 }) });
    const res = await server.inject('/x');
    assert.deepEqual(res.result, { data: 1 });
  });
});

describe('request context', () => {
  it('generates a request id and echoes it on success', async () => {
    const server = await bare();
    server.route({ method: 'GET', path: '/x', handler: () => 'ok' });
    assert.match(String((await server.inject('/x')).headers['x-request-id']), /^req_[0-9a-f]{32}$/);
  });

  it('honours a well-formed upstream id and replaces a malformed one', async () => {
    const server = await bare();
    server.route({ method: 'GET', path: '/x', handler: () => 'ok' });
    assert.equal((await server.inject({ url: '/x', headers: { 'x-request-id': 'trace-1.a:b' } })).headers['x-request-id'], 'trace-1.a:b');
    const bad = await server.inject({ url: '/x', headers: { 'x-request-id': 'bad id with spaces' } });
    assert.match(String(bad.headers['x-request-id']), /^req_/);
    const long = await server.inject({ url: '/x', headers: { 'x-request-id': 'a'.repeat(129) } });
    assert.match(String(long.headers['x-request-id']), /^req_/);
  });

  it('gives handlers a request-scoped logger', async () => {
    const server = await bare();
    server.route({ method: 'GET', path: '/x', handler: (r) => ({ hasLogger: typeof r.app.logger.info === 'function', id: r.app.requestId }) });
    const res = await server.inject('/x');
    assert.equal((res.result as { hasLogger: boolean }).hasLogger, true);
  });
});

describe('clientIp', () => {
  const req = (xff: string | undefined, remoteAddress = '10.0.0.9') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, info: { remoteAddress } }) as unknown as Request;
  it('uses the socket address when no proxy is trusted, ignoring spoofed headers', () => {
    assert.equal(clientIp(req('1.1.1.1'), 0), '10.0.0.9');
  });
  it('trusts only the entry added by our own proxy', () => {
    assert.equal(clientIp(req('6.6.6.6, 203.0.113.5'), 1), '203.0.113.5');
    assert.equal(clientIp(req('6.6.6.6, 203.0.113.5, 10.1.1.1'), 2), '203.0.113.5');
  });
  it('falls back to the socket when the header is missing or too short', () => {
    assert.equal(clientIp(req(undefined), 1), '10.0.0.9');
    assert.equal(clientIp(req('203.0.113.5'), 2), '10.0.0.9');
    assert.equal(clientIp(req(' , '), 1), '10.0.0.9');
  });
});

class StubLimiter implements RateLimiter {
  calls: { policy: string; subject: string }[] = [];
  constructor(private readonly decide: () => Decision | Error) {}
  async consume(policy: Policy, subject: string) {
    this.calls.push({ policy: policy.name, subject });
    const d = this.decide();
    if (d instanceof Error) throw d;
    return d;
  }
  async reset() {}
  async close() {}
}
const POLICY: Policy = { name: 'test:ip', limit: 2, windowMs: 60_000 };

async function limited(limiter: StubLimiter | undefined, extra: Record<string, string> = {}, routeRateLimit: { ip: Policy[]; failClosed?: boolean } = { ip: [POLICY] }) {
  const server = await bare();
  server.app.env = env({ RATE_LIMIT_ENABLED: 'true', REDIS_URL: 'redis://localhost:6379', ...extra });
  if (limiter) server.app.rateLimiter = limiter;
  await server.register(rateLimit());
  server.route({ method: 'GET', path: '/x', options: { plugins: { rateLimit: routeRateLimit } }, handler: () => 'ok' });
  server.route({ method: 'GET', path: '/free', handler: () => 'ok' });
  return server;
}

describe('rate limit plugin', () => {
  it('lets requests through while under the limit', async () => {
    const limiter = new StubLimiter(() => ({ allowed: true, count: 1, retryAfterSeconds: 60 }));
    const res = await (await limited(limiter)).inject('/x');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(limiter.calls, [{ policy: 'test:ip', subject: '127.0.0.1' }]);
  });

  it('answers 429 RATE_LIMITED with Retry-After once exhausted', async () => {
    const limiter = new StubLimiter(() => ({ allowed: false, count: 3, retryAfterSeconds: 17 }));
    const res = await (await limited(limiter)).inject('/x');
    assert.equal(res.statusCode, 429);
    assert.equal((res.result as Envelope).error.code, 'RATE_LIMITED');
    assert.equal(res.headers['retry-after'], '17');
  });

  it('applies every listed policy', async () => {
    const limiter = new StubLimiter(() => ({ allowed: true, count: 1, retryAfterSeconds: 1 }));
    const second: Policy = { name: 'second', limit: 1, windowMs: 60_000 };
    await (await limited(limiter, {}, { ip: [POLICY, second] })).inject('/x');
    assert.deepEqual(limiter.calls.map((c) => c.policy), ['test:ip', 'second']);
  });

  it('does not touch routes with no policy', async () => {
    const limiter = new StubLimiter(() => ({ allowed: false, count: 99, retryAfterSeconds: 1 }));
    const res = await (await limited(limiter)).inject('/free');
    assert.equal(res.statusCode, 200);
    assert.equal(limiter.calls.length, 0);
  });

  it('fails open when Redis is down by default', async () => {
    const limiter = new StubLimiter(() => new Error('ECONNREFUSED'));
    assert.equal((await (await limited(limiter)).inject('/x')).statusCode, 200);
  });

  it('fails closed with 503 for credential routes when Redis is down', async () => {
    const limiter = new StubLimiter(() => new Error('ECONNREFUSED'));
    const res = await (await limited(limiter, {}, { ip: [POLICY], failClosed: true })).inject('/x');
    assert.equal(res.statusCode, 503);
    assert.equal((res.result as Envelope).error.code, 'SERVICE_UNAVAILABLE');
  });

  it('is a no-op when disabled or when no limiter is configured', async () => {
    const limiter = new StubLimiter(() => ({ allowed: false, count: 9, retryAfterSeconds: 1 }));
    assert.equal((await (await limited(limiter, { RATE_LIMIT_ENABLED: 'false' })).inject('/x')).statusCode, 200);
    assert.equal((await (await limited(undefined)).inject('/x')).statusCode, 200);
  });

  it('enforce() can be called directly with a custom subject', async () => {
    const limiter = new StubLimiter(() => ({ allowed: false, count: 9, retryAfterSeconds: 5 }));
    const server = await limited(limiter);
    const request = { server, app: { logger: createLogger('error') } } as unknown as Request;
    await assert.rejects(enforce(request, POLICY, 'user@example.com'), (e: Boom.Boom) => e.output.statusCode === 429);
    assert.equal(limiter.calls[0]!.subject, 'user@example.com');
  });
});

describe('authentication plugins (no database configured)', () => {
  const build = async () => createServer({ env: env({ AUTH_TOKEN_SECRET: 'x'.repeat(32) }), logger: createLogger('error') });

  it('customer routes demand a bearer token', async () => {
    const res = await (await build()).inject('/api/v1/me');
    assert.equal(res.statusCode, 401);
    assert.equal((res.result as Envelope).error.code, 'UNAUTHENTICATED');
  });

  it('customer routes refuse malformed or forged tokens', async () => {
    const server = await build();
    for (const authorization of ['Basic abc', 'Bearer', 'Bearer not.a.jwt', 'Bearer a b']) {
      const res = await server.inject({ url: '/api/v1/me', headers: { authorization } });
      assert.equal(res.statusCode, 401, authorization);
    }
  });

  it('admin routes demand a bearer token and refuse unknown ones', async () => {
    const server = await build();
    const none = await server.inject('/api/v1/admin/me');
    assert.equal(none.statusCode, 401);
    const bad = await server.inject({ url: '/api/v1/admin/me', headers: { authorization: 'Bearer abc.def' } });
    assert.equal(bad.statusCode, 401);
    assert.equal((bad.result as Envelope).error.code, 'UNAUTHENTICATED');
  });
});
