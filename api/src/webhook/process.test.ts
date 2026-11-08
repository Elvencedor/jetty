import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db } from '../db/client.js';
import type { PaymentProvider } from '../modules/payments/provider.js';
import { handlePaystackEvent } from './process.js';

// None of these cases may reach the database or the provider: they are decided from the body alone.
const forbidden = new Proxy({}, { get: () => () => assert.fail('should not be touched') });
const db = forbidden as unknown as Db;
const provider = forbidden as unknown as PaymentProvider;
const body = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v));

describe('handlePaystackEvent (decided from the body alone)', () => {
  it('rejects a body that is not JSON', async () => {
    assert.deepEqual(await handlePaystackEvent(db, provider, body('{not json')), { status: 400 });
  });
  it('rejects JSON without an event name', async () => {
    assert.deepEqual(await handlePaystackEvent(db, provider, body({})), { status: 400 });
    assert.deepEqual(await handlePaystackEvent(db, provider, body({ event: 5 })), { status: 400 });
    assert.deepEqual(await handlePaystackEvent(db, provider, body('null')), { status: 400 });
  });
  it('acknowledges and ignores events that are not charges', async () => {
    const r = await handlePaystackEvent(db, provider, body({ event: 'transfer.success', data: { reference: 'r' } }));
    assert.deepEqual(r, { status: 200, outcome: 'ignored' });
  });
  it('ignores a charge event with no usable reference', async () => {
    assert.deepEqual(await handlePaystackEvent(db, provider, body({ event: 'charge.success' })), { status: 200, outcome: 'ignored' });
    assert.deepEqual(await handlePaystackEvent(db, provider, body({ event: 'charge.success', data: { reference: 12 } })), { status: 200, outcome: 'ignored' });
  });
});
