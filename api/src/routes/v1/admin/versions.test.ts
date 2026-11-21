import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq, inArray, sql } from 'drizzle-orm';
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

  describe('reordering content', () => {
    // Each test starts from an empty list, so the order it expects is the whole list.
    beforeEach(async () => {
      await t.db.delete(contentEntries).where(inArray(contentEntries.contentType, ['tile', 'story']));
    });
    const put = async (payload: Json) => {
      const res = await api.inject({ method: 'PUT', url: '/api/v1/admin/content/order', payload, headers: owner.headers });
      return { status: res.statusCode, body: res.result as Json };
    };
    const make = async (type: 'tile' | 'story', n: number) => {
      const rows = [];
      for (let i = 0; i < n; i++) {
        const [row] = await t.db.insert(contentEntries).values({ contentType: type, slug: `${type}-${Math.random().toString(36).slice(2, 8)}`, title: `${type} ${i}`, body: type === 'tile' ? { title: `t${i}`, linkUrl: '/x' } : { title: `s${i}`, linkUrl: '/x' }, sortOrder: i * 10 }).returning();
        rows.push(row!);
      }
      return rows;
    };
    const order = async (type: string) => (await t.db.select().from(contentEntries).where(eq(contentEntries.contentType, type))).filter((r) => r.status !== 'archived').sort((a, b) => a.sortOrder - b.sortOrder);
    const expectedOf = (rows: { id: string; sortOrder: number }[]) => rows.map((r) => ({ id: r.id, sortOrder: r.sortOrder }));

    it('puts the whole list in the new order in one step, and only touches entries whose place changed', async () => {
      const [a, b, c] = await make('tile', 3);
      const res = await put({ contentType: 'tile', ids: [c!.id, a!.id, b!.id], expected: expectedOf([a!, b!, c!]) });
      assert.equal(res.status, 200);
      assert.deepEqual((await order('tile')).map((r) => [r.id, r.sortOrder]), [[c!.id, 0], [a!.id, 10], [b!.id, 20]]);
      assert.deepEqual(res.body.data.map((r: Json) => r.id), [c!.id, a!.id, b!.id]);
      const [bAfter] = await t.db.select().from(contentEntries).where(eq(contentEntries.id, b!.id));
      assert.equal(bAfter!.version, b!.version + 1, 'b moved from 10 to 20');
    });

    it('is not refused because someone edited an entry in the meantime: that does not change the order', async () => {
      const [a, b] = await make('tile', 2);
      await t.db.update(contentEntries).set({ title: 'Edited meanwhile' }).where(eq(contentEntries.id, a!.id));
      const res = await put({ contentType: 'tile', ids: [b!.id, a!.id], expected: expectedOf([a!, b!]) });
      assert.equal(res.status, 200);
    });

    it('is refused, and changes nothing, when someone else moved an entry first; the stored order comes back', async () => {
      const [a, b, c] = await make('tile', 3);
      await t.db.update(contentEntries).set({ sortOrder: 5 }).where(eq(contentEntries.id, c!.id));
      const res = await put({ contentType: 'tile', ids: [b!.id, a!.id, c!.id], expected: expectedOf([a!, b!, c!]) });
      assert.equal(res.status, 412);
      assert.deepEqual(res.body.error.details[0].currentOrder, [{ id: a!.id, sortOrder: 0 }, { id: c!.id, sortOrder: 5 }, { id: b!.id, sortOrder: 10 }]);
      assert.deepEqual((await order('tile')).map((r) => r.id), [a!.id, c!.id, b!.id], 'the stored order is untouched');
    });

    it('is refused when an entry was added or archived since it was read', async () => {
      const [a, b] = await make('tile', 2);
      const [added] = await make('tile', 1);
      assert.equal((await put({ contentType: 'tile', ids: [b!.id, a!.id], expected: expectedOf([a!, b!]) })).status, 412, 'one more entry than the admin saw');
      await t.db.update(contentEntries).set({ status: 'archived' }).where(eq(contentEntries.id, added!.id));
      assert.equal((await put({ contentType: 'tile', ids: [b!.id, a!.id], expected: expectedOf([a!, b!]) })).status, 200, 'archived entries are not part of the list');
    });

    it('refuses an order that does not list every entry once, and changes nothing', async () => {
      const [a, b] = await make('story', 2);
      assert.equal((await put({ contentType: 'story', ids: [a!.id, a!.id], expected: expectedOf([a!, b!]) })).status, 422);
      assert.equal((await put({ contentType: 'story', ids: [a!.id], expected: expectedOf([a!, b!]) })).status, 422);
      assert.deepEqual((await order('story')).map((r) => r.id), [a!.id, b!.id]);
    });

    it('lets only one of two racing reorders win, and leaves other types alone', async () => {
      const [a, b, c] = await make('story', 3);
      const tiles = await make('tile', 2);
      const expected = expectedOf([a!, b!, c!]);
      // Two different new orders, both made from the list as it was: whichever lands second finds the order already changed.
      const race = await Promise.all([[b!.id, a!.id, c!.id], [c!.id, b!.id, a!.id]].map((ids) => put({ contentType: 'story', ids, expected })));
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 412]);
      assert.deepEqual((await order('tile')).map((r) => [r.id, r.sortOrder]), tiles.map((r) => [r.id, r.sortOrder]));
    });
  });
});
