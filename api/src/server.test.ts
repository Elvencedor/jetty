import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { loadEnv } from './config/env.js';
import type { Database } from './db/client.js';
import { createLogger } from './lib/logger.js';
import { createServer } from './server.js';

describe('api server', () => {
  let server: Server;

  before(async () => {
    const env = loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error' });
    server = await createServer({ env, logger: createLogger('error') });
    await server.initialize();
  });

  after(async () => {
    await server.stop();
  });

  it('answers the liveness probe outside the versioned prefix', async () => {
    const res = await server.inject('/healthz');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.result, { status: 'ok' });
  });

  it('answers the readiness probe', async () => {
    const res = await server.inject('/readyz');
    assert.equal(res.statusCode, 200);
    assert.equal((res.result as { status: string }).status, 'ready');
  });

  it('reports unavailable when the database ping fails', async () => {
    const env = loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error' });
    const failing = await createServer({
      env,
      logger: createLogger('error'),
      database: {
        ping: async () => {
          throw new Error('connection refused');
        },
      } as unknown as Database,
    });
    const res = await failing.inject('/readyz');
    assert.equal(res.statusCode, 503);
    assert.deepEqual((res.result as { checks: unknown }).checks, { database: 'unavailable' });
  });

  it('requires DATABASE_URL in production', () => {
    assert.throws(() => loadEnv({ NODE_ENV: 'production' }), /DATABASE_URL/);
  });

  it('mounts versioned routes under /api/v1', async () => {
    const res = await server.inject('/api/v1/meta');
    assert.equal(res.statusCode, 200);
    assert.equal((res.result as { data: { apiVersion: string } }).data.apiVersion, 'v1');
  });

  it('returns the documented error envelope for unknown routes', async () => {
    const res = await server.inject('/api/v1/does-not-exist');
    assert.equal(res.statusCode, 404);

    const body = res.result as { error: { code: string; message: string; requestId: string } };
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(body.error.requestId.startsWith('req_'));
    assert.equal(res.headers['x-request-id'], body.error.requestId);
  });

  it('echoes an upstream request id for trace correlation', async () => {
    const res = await server.inject({ url: '/healthz', headers: { 'x-request-id': 'trace-abc-123' } });
    assert.equal(res.headers['x-request-id'], 'trace-abc-123');
  });

  it('rejects an invalid environment', () => {
    assert.throws(() => loadEnv({ NODE_ENV: 'staging' }), /Invalid environment configuration/);
  });
});

describe('browser access', () => {
  it('lets allowed origins send If-Match and Idempotency-Key and read the ETag', async () => {
    const env = loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error', CORS_ORIGINS: 'https://admin.example.com' });
    const s = await createServer({ env, logger: createLogger('error') });
    const res = await s.inject({
      method: 'OPTIONS',
      url: '/api/v1/admin/products/00000000-0000-4000-8000-000000000000',
      headers: { origin: 'https://admin.example.com', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,if-match,idempotency-key,content-type' },
    });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['access-control-allow-headers']), /if-match/i);
    assert.match(String(res.headers['access-control-allow-headers']), /idempotency-key/i);
    assert.match(String(res.headers['access-control-expose-headers']), /etag/i);
    assert.equal(res.headers['access-control-allow-origin'], 'https://admin.example.com');
  });
});
