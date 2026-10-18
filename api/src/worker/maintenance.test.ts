import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { idempotencyKeys } from '../db/schema/index.js';
import { beginIdempotent, cleanupIdempotencyKeys, completeIdempotent, IN_FLIGHT_TIMEOUT_MS } from '../lib/idempotency.js';
import { createLogger } from '../lib/logger.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../testing/database.js';
import { runMaintenance } from './maintenance.js';

describe('idempotency key cleanup', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t?.destroy();
  });

  const keys = async () => (await t.db.select().from(idempotencyKeys)).map((k) => k.key).sort();
  const reset = () => t.db.delete(idempotencyKeys);
  const start = (key: string, now?: Date) => beginIdempotent(t.db, { scope: 'test', key, requestHash: 'h', ...(now ? { now } : {}) });

  it('removes expired keys and abandoned in-flight claims, and keeps live ones', async () => {
    await reset();
    const now = new Date();
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const stale = new Date(now.getTime() - IN_FLIGHT_TIMEOUT_MS - 60_000);

    const expired = await start('expired-complete', old);
    await completeIdempotent(t.db, expired.kind === 'new' ? expired.id : '', 201, { ok: true });
    await start('stuck-in-flight');
    await t.db.update(idempotencyKeys).set({ createdAt: stale }).where(eq(idempotencyKeys.key, 'stuck-in-flight'));
    await start('fresh-in-flight');
    const done = await start('fresh-complete');
    await completeIdempotent(t.db, done.kind === 'new' ? done.id : '', 201, { ok: true });

    assert.equal(await cleanupIdempotencyKeys(t.db, now), 2);
    assert.deepEqual(await keys(), ['fresh-complete', 'fresh-in-flight']);
    assert.equal(await cleanupIdempotencyKeys(t.db, now), 0);
  });

  it('keeps a completed key replayable until it expires, even when older than the in-flight timeout', async () => {
    await reset();
    const started = await start('replayable');
    await completeIdempotent(t.db, started.kind === 'new' ? started.id : '', 201, { n: 1 });
    await t.db.update(idempotencyKeys).set({ createdAt: new Date(Date.now() - 2 * IN_FLIGHT_TIMEOUT_MS) });
    await cleanupIdempotencyKeys(t.db);
    const again = await start('replayable');
    assert.equal(again.kind, 'replay');
  });

  it('lets a retry through once an abandoned claim is stale, while still refusing a live one', async () => {
    await reset();
    await start('crashed');
    await assert.rejects(() => start('crashed'), (err: { data?: { code?: string } }) => err.data?.code === 'IDEMPOTENCY_IN_PROGRESS');
    await t.db.update(idempotencyKeys).set({ createdAt: new Date(Date.now() - IN_FLIGHT_TIMEOUT_MS - 1000) });
    assert.equal((await start('crashed')).kind, 'new');
  });

  it('runs every maintenance task in one pass', async () => {
    await reset();
    await start('old');
    await t.db.update(idempotencyKeys).set({ expiresAt: new Date(Date.now() - 1000) });
    const result = await runMaintenance(t.db, createLogger('error'));
    assert.deepEqual(result, { reservationsReleased: 0, idempotencyKeysRemoved: 1, authChallengesRemoved: 0, staleCodesScrubbed: 0, failed: [] });
  });
});
