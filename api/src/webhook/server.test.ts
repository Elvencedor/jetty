import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import type { Database } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import type { PaymentProvider } from '../modules/payments/provider.js';
import { createWebhookServer } from './server.js';

const SECRET = 'whsec_test_secret';
const env = loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error' });
const sign = (raw: string) => createHmac('sha512', SECRET).update(raw).digest('hex');

async function build() {
  const server = await createWebhookServer({
    env,
    database: { ping: async () => undefined } as unknown as Database,
    payments: {} as PaymentProvider,
    signingSecret: SECRET,
    logger: createLogger('error'),
  });
  await server.initialize();
  return server;
}

describe('webhook server', () => {
  it('exposes health probes', async () => {
    const server = await build();
    assert.equal((await server.inject('/healthz')).statusCode, 200);
  });

  it('exposes nothing but the webhook and health routes', async () => {
    const server = await build();
    assert.equal((await server.inject('/api/v1/meta')).statusCode, 404);
    assert.equal((await server.inject({ method: 'GET', url: '/webhooks/paystack' })).statusCode, 404);
  });

  it('rejects an unsigned event with 401 and an error body', async () => {
    const server = await build();
    const res = await server.inject({ method: 'POST', url: '/webhooks/paystack', payload: '{"event":"charge.success"}' });
    assert.equal(res.statusCode, 401);
    assert.equal((res.result as { error: { code: string } }).error.code, 'INVALID_SIGNATURE');
  });

  it('rejects a wrongly signed event', async () => {
    const server = await build();
    const res = await server.inject({ method: 'POST', url: '/webhooks/paystack', headers: { 'x-paystack-signature': 'ab'.repeat(64) }, payload: '{"event":"charge.success"}' });
    assert.equal(res.statusCode, 401);
  });

  it('acknowledges a signed event it does not act on', async () => {
    const server = await build();
    const payload = JSON.stringify({ event: 'transfer.success', data: { reference: 'x' } });
    const res = await server.inject({ method: 'POST', url: '/webhooks/paystack', headers: { 'x-paystack-signature': sign(payload) }, payload });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.result, { received: true, outcome: 'ignored' });
  });

  it('answers 400 to a signed but malformed event', async () => {
    const server = await build();
    const payload = '{"nope":true}';
    const res = await server.inject({ method: 'POST', url: '/webhooks/paystack', headers: { 'x-paystack-signature': sign(payload) }, payload });
    assert.equal(res.statusCode, 400);
    assert.equal((res.result as { error: { code: string } }).error.code, 'BAD_REQUEST');
  });

  it('refuses oversized bodies before verifying them', async () => {
    const server = await build();
    const res = await server.inject({ method: 'POST', url: '/webhooks/paystack', payload: 'x'.repeat(70 * 1024) });
    assert.equal(res.statusCode, 413);
  });

  it('sends security headers and a request id', async () => {
    const server = await build();
    const res = await server.inject('/healthz');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(String(res.headers['x-request-id']), /^req_/);
  });
});
