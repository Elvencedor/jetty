import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq, sql } from 'drizzle-orm';
import { categories, collections, contentEntries, deliveryPrepTimes, deliveryZones, promotions } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';

type Json = Record<string, any>;

describe('versioned admin records', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  const send = async (method: string, url: string, payload: Json, ifMatch?: string | number) => {
    const res = await api.inject({ method: method as 'PATCH', url: `/api/v1${url}`, payload, headers: { ...owner.headers, ...(ifMatch === undefined ? {} : { 'if-match': `"${ifMatch}"` }) } });
    return { status: res.statusCode, body: res.result as Json, etag: res.headers.etag as string | undefined };
  };

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  /** The same four checks for every record that is edited with If-Match. */
  const behavesLikeAVersionedRecord = (name: string, make: () => Promise<{ url: string; edit: (n: number) => Json; version: () => Promise<number> }>) =>
    it(`${name}: needs the version, refuses a stale or invented one, and moves it up by one`, async () => {
      const { url, edit, version } = await make();
      const v1 = await version();
      assert.equal((await send('PATCH', url, edit(1))).status, 428, 'no version sent');
      const ok = await send('PATCH', url, edit(1), v1);
      assert.equal(ok.status, 200);
      assert.equal(await version(), v1 + 1);
      const stale = await send('PATCH', url, edit(2), v1);
      assert.equal(stale.status, 412, 'the version it read is old now');
      assert.equal(stale.body.error.details[0].currentVersion, v1 + 1);
      assert.equal((await send('PATCH', url, edit(2), v1 + 40)).status, 412, 'a version the record has not reached');
      const race = await Promise.all([3, 4].map((n) => send('PATCH', url, edit(n), v1 + 1)));
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 412], 'one of two racing edits lands');
    });

  behavesLikeAVersionedRecord('category', async () => {
    const [row] = await t.db.insert(categories).values({ slug: 'v-cat', name: 'V cat' }).returning();
    return { url: `/admin/categories/${row!.id}`, edit: (n) => ({ name: `V cat ${n}` }), version: async () => (await t.db.select().from(categories).where(eq(categories.id, row!.id)))[0]!.version };
  });
  behavesLikeAVersionedRecord('collection', async () => {
    const [row] = await t.db.insert(collections).values({ slug: 'v-col', name: 'V col' }).returning();
    return { url: `/admin/collections/${row!.id}`, edit: (n) => ({ name: `V col ${n}` }), version: async () => (await t.db.select().from(collections).where(eq(collections.id, row!.id)))[0]!.version };
  });
  behavesLikeAVersionedRecord('content entry', async () => {
    const [row] = await t.db.insert(contentEntries).values({ contentType: 'announcement', slug: 'v-ann', title: 'V', body: { text: 'hi' } }).returning();
    return { url: `/admin/content/${row!.id}`, edit: (n) => ({ title: `V ${n}` }), version: async () => (await t.db.select().from(contentEntries).where(eq(contentEntries.id, row!.id)))[0]!.version };
  });
  behavesLikeAVersionedRecord('prep time', async () => {
    const [row] = await t.db.insert(deliveryPrepTimes).values({ name: 'V prep', mode: 'days', days: 5 }).returning();
    return { url: `/admin/settings/prep-times/${row!.id}`, edit: (n) => ({ name: `V prep ${n}` }), version: async () => (await t.db.select().from(deliveryPrepTimes).where(eq(deliveryPrepTimes.id, row!.id)))[0]!.version };
  });
  behavesLikeAVersionedRecord('promotion', async () => {
    const [row] = await t.db.insert(promotions).values({ name: 'V promo', kind: 'percentage', status: 'active', configuration: { version: 1, percent: 10 }, scope: {} }).returning();
    return { url: `/admin/promotions/${row!.id}`, edit: (n) => ({ name: `V promo ${n}` }), version: async () => (await t.db.select().from(promotions).where(eq(promotions.id, row!.id)))[0]!.version };
  });

  it('delivery zone: the version travels with the zone, and a missing or stale one is refused', async () => {
    const [zone] = await t.db.insert(deliveryZones).values({ name: 'V zone', state: 'Lagos', deliveryFeeMinor: 100 }).returning();
    const patch = (fields: Json) => send('PATCH', '/admin/settings/delivery-zones', { zones: [{ id: zone!.id, ...fields }] });
    assert.equal((await patch({ deliveryFeeMinor: 200 })).status, 428);
    assert.equal((await patch({ deliveryFeeMinor: 200, version: zone!.version })).status, 200);
    const stale = await patch({ deliveryFeeMinor: 300, version: zone!.version });
    assert.equal(stale.status, 412);
    assert.equal(stale.body.error.details[0].currentVersion, zone!.version + 1);
    const [now] = await t.db.select().from(deliveryZones).where(eq(deliveryZones.id, zone!.id));
    assert.equal(now!.deliveryFeeMinor, 200, 'the stale edit changed nothing');
  });

  it('setting: the first save is version 0, later saves need the one they read, and two first saves cannot both win', async () => {
    const read = await api.inject({ url: '/api/v1/admin/settings/policies', headers: owner.headers });
    assert.equal(read.headers.etag, '"0"', 'never saved yet');
    assert.equal((await send('PATCH', '/admin/settings/policies', { returnWindowDays: 10 })).status, 428);
    const first = await Promise.all([14, 21].map((d) => send('PATCH', '/admin/settings/policies', { returnWindowDays: d }, 0)));
    assert.deepEqual(first.map((r) => r.status).sort(), [200, 412], 'only one first save lands');
    const winner = first.find((r) => r.status === 200)!;
    assert.equal(winner.etag, '"1"');
    assert.equal((await send('PATCH', '/admin/settings/policies', { returnWindowDays: 7 }, 1)).etag, '"2"');
    assert.equal((await send('PATCH', '/admin/settings/policies', { returnWindowDays: 9 }, 1)).status, 412);
  });

  it('creating needs no version, and a version sent with a create is not checked: only edits are', async () => {
    const created = async (method: string, url: string, payload: Json, ifMatch?: string | number) => (await send(method, url, payload, ifMatch)).status;
    assert.equal(await created('POST', '/admin/categories', { name: 'Create cat' }), 201);
    assert.equal(await created('POST', '/admin/collections', { name: 'Create col' }), 201);
    assert.equal(await created('POST', '/admin/content', { contentType: 'announcement', title: 'Create ann', body: { text: 'hello' } }), 201);
    assert.equal(await created('POST', '/admin/promotions', { name: 'Create promo', kind: 'percentage', configuration: { version: 1, percent: 5 } }), 201);
    assert.equal(await created('POST', '/admin/settings/prep-times', { name: 'Create prep', mode: 'days', days: 3 }), 200);
    assert.equal(await created('POST', '/admin/products', { title: 'Create product' }), 201);
    assert.equal(await created('PATCH', '/admin/settings/delivery-zones', { zones: [{ name: 'Create zone', state: 'Oyo', deliveryFeeMinor: 100 }] }), 200);
    // A stale or invented version on a create changes nothing: there is no record for it to be stale against.
    assert.equal(await created('POST', '/admin/categories', { name: 'Create cat 2' }, 999), 201);
    assert.equal(await created('POST', '/admin/settings/prep-times', { name: 'Create prep 2', mode: 'days', days: 3 }, 999), 200);
  });

  it('a redemption counting up does not make a promotion form stale', async () => {
    const [promo] = await t.db.insert(promotions).values({ name: 'V count', kind: 'percentage', status: 'active', configuration: { version: 1, percent: 5 }, scope: {} }).returning();
    await t.db.update(promotions).set({ usageCount: sql`${promotions.usageCount} + 1` }).where(eq(promotions.id, promo!.id));
    const [after] = await t.db.select().from(promotions).where(eq(promotions.id, promo!.id));
    assert.equal(after!.usageCount, 1);
    assert.equal(after!.version, promo!.version, 'counting a redemption is not an edit');
    await t.db.update(promotions).set({ name: 'V count 2' }).where(eq(promotions.id, promo!.id));
    assert.equal((await t.db.select().from(promotions).where(eq(promotions.id, promo!.id)))[0]!.version, promo!.version + 1, 'a real edit is');
  });
});
