import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { idempotencyKeys } from '../db/schema/index.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../testing/database.js';
import { apiError, unprocessable } from './errors.js';
import { beginIdempotent, completeIdempotent, hashRequest, runIdempotent } from './idempotency.js';

describe('runIdempotent', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let n = 0;
  const key = () => `key-${++n}`;

  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t?.destroy();
  });

  it('runs once and replays the stored result for the same payload, in any key order', async () => {
    const k = key();
    let runs = 0;
    const run = async () => ({ status: 201, body: { order: ++runs } });
    const first = await runIdempotent(t.db, { scope: 's', key: k, payload: { a: 1, b: 2 } }, run);
    const second = await runIdempotent(t.db, { scope: 's', key: k, payload: { b: 2, a: 1 } }, run);
    assert.deepEqual([first.replayed, second.replayed], [false, true]);
    assert.deepEqual(second, { status: 201, body: { order: 1 }, replayed: true });
    assert.equal(runs, 1);
  });

  it('refuses the same key with a different payload (409)', async () => {
    const k = key();
    await runIdempotent(t.db, { scope: 's', key: k, payload: { a: 1 } }, async () => ({ status: 200, body: {} }));
    await assert.rejects(runIdempotent(t.db, { scope: 's', key: k, payload: { a: 2 } }, async () => ({ status: 200, body: {} })), (e: { output: { statusCode: number }; data: { code: string } }) => e.output.statusCode === 409 && e.data.code === 'IDEMPOTENCY_KEY_REUSED');
  });

  it('keeps scopes separate, so two users can pick the same key', async () => {
    const k = key();
    const a = await runIdempotent(t.db, { scope: 'u1', key: k, payload: {} }, async () => ({ status: 200, body: 'u1' }));
    const b = await runIdempotent(t.db, { scope: 'u2', key: k, payload: {} }, async () => ({ status: 200, body: 'u2' }));
    assert.deepEqual([a.body, b.body], ['u1', 'u2']);
    assert.equal(b.replayed, false);
  });

  it('answers 409 while a request with the same key is still in flight', async () => {
    const k = key();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = runIdempotent(t.db, { scope: 's', key: k, payload: {} }, async () => (await gate, { status: 200, body: 'done' }));
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(runIdempotent(t.db, { scope: 's', key: k, payload: {} }, async () => ({ status: 200, body: 'dup' })), (e: { data: { code: string } }) => e.data.code === 'IDEMPOTENCY_IN_PROGRESS');
    release();
    assert.equal((await slow).body, 'done');
  });

  it('only one of several simultaneous identical requests runs', async () => {
    const k = key();
    let runs = 0;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => runIdempotent(t.db, { scope: 's', key: k, payload: {} }, async () => { runs++; await new Promise((r) => setTimeout(r, 30)); return { status: 200, body: 'ok' }; })));
    assert.equal(runs, 1);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  });

  it('frees the key after a client error so a corrected retry can proceed', async () => {
    const k = key();
    await assert.rejects(runIdempotent(t.db, { scope: 's', key: k, payload: { qty: 0 } }, async () => { throw unprocessable('VALIDATION_FAILED', 'bad'); }));
    const retry = await runIdempotent(t.db, { scope: 's', key: k, payload: { qty: 1 } }, async () => ({ status: 200, body: 'ok' }));
    assert.equal(retry.replayed, false);
  });

  it('keeps the key claimed after a server error, because side effects may exist', async () => {
    const k = key();
    await assert.rejects(runIdempotent(t.db, { scope: 's', key: k, payload: {} }, async () => { throw apiError(503, 'DOWN', 'down'); }));
    await assert.rejects(runIdempotent(t.db, { scope: 's', key: k, payload: {} }, async () => ({ status: 200, body: 'again' })), (e: { data: { code: string } }) => e.data.code === 'IDEMPOTENCY_IN_PROGRESS');
  });

  it('keeps the key claimed after an unexpected (non-HTTP) error', async () => {
    const k = key();
    await assert.rejects(runIdempotent(t.db, { scope: 's', key: k, payload: {} }, async () => { throw new Error('boom'); }), /boom/);
    const rows = await t.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, k));
    assert.equal(rows.length, 1);
  });

  it('a returned (not thrown) error status is stored and replayed', async () => {
    const k = key();
    await runIdempotent(t.db, { scope: 's', key: k, payload: {} }, async () => ({ status: 402, body: { declined: true } }));
    const again = await runIdempotent(t.db, { scope: 's', key: k, payload: {} }, async () => ({ status: 200, body: 'new' }));
    assert.deepEqual([again.status, again.replayed], [402, true]);
  });

  it('beginIdempotent reaps a claim that expired, and completeIdempotent stores the response', async () => {
    const k = key();
    const past = new Date(Date.now() - 48 * 3600_000);
    const old = await beginIdempotent(t.db, { scope: 's', key: k, requestHash: hashRequest({}), now: past });
    assert.equal(old.kind, 'new');
    if (old.kind === 'new') await completeIdempotent(t.db, old.id, 200, { v: 1 });
    const fresh = await beginIdempotent(t.db, { scope: 's', key: k, requestHash: hashRequest({ other: true }) });
    assert.equal(fresh.kind, 'new');
  });
});
