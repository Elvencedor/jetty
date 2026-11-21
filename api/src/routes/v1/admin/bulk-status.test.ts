import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq, inArray } from 'drizzle-orm';
import { adminAuditLog, categories, productVariants, products } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';

type Json = Record<string, any>;
const MISSING = '00000000-0000-4000-8000-000000000001';

describe('bulk status changes', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;
  let seq = 0;

  const post = async (url: string, payload: Json, who = owner) => {
    const res = await api.inject({ method: 'POST', url: `/api/v1${url}`, payload, headers: who.headers });
    return { status: res.statusCode, body: res.result as Json };
  };
  const product = async (over: Partial<typeof products.$inferInsert> = {}, variant: 'active' | 'inactive' | 'none' = 'active') => {
    const n = ++seq;
    const [p] = await t.db.insert(products).values({ slug: `bulk-${n}`, title: `Bulk ${n}`, status: 'draft', ...over }).returning();
    if (variant !== 'none') await t.db.insert(productVariants).values({ productId: p!.id, sku: `BULK-${n}`, optionSignature: {}, priceMinor: 1000, active: variant === 'active' });
    return p!;
  };
  const row = async (id: string) => (await t.db.select().from(products).where(eq(products.id, id)))[0]!;

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    support = await signInAdmin(t.db, api, 'support');
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  describe('products', () => {
    it('reports exactly what happened to each product: updated, unchanged, skipped (with why) and missing', async () => {
      const draftWithVariant = await product();
      const draftNoVariant = await product({}, 'none');
      const draftInactiveVariant = await product({}, 'inactive');
      const alreadyActive = await product({ status: 'active', publishedAt: new Date('2026-01-01') });
      const archived = await product({ status: 'archived', publishedAt: new Date('2025-06-01') });
      const res = await post('/admin/products/bulk-status', { ids: [draftWithVariant.id, draftNoVariant.id, draftInactiveVariant.id, alreadyActive.id, archived.id, MISSING], status: 'active' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.updated.map((u: Json) => u.id).sort(), [draftWithVariant.id, archived.id].sort());
      assert.deepEqual(res.body.updated.find((u: Json) => u.id === archived.id).previousStatus, 'archived');
      assert.deepEqual(res.body.unchanged, [alreadyActive.id]);
      assert.deepEqual(res.body.skipped.map((s: Json) => [s.id, s.code]).sort(), [[draftNoVariant.id, 'NOT_PUBLISHABLE'], [draftInactiveVariant.id, 'NOT_PUBLISHABLE']].sort());
      assert.match(res.body.skipped[0].reason, /active variant/);
      assert.deepEqual(res.body.missing, [MISSING]);
      assert.equal(res.body.requested, 6);

      assert.equal((await row(draftWithVariant.id)).status, 'active');
      assert.ok((await row(draftWithVariant.id)).publishedAt, 'first publish stamps the date');
      assert.equal((await row(archived.id)).publishedAt?.toISOString(), '2025-06-01T00:00:00.000Z', 'an earlier publish date is kept');
      assert.equal((await row(draftNoVariant.id)).status, 'draft', 'a skipped product is untouched');
      assert.equal((await row(alreadyActive.id)).version, alreadyActive.version, 'an unchanged product is not touched');
      assert.equal((await row(draftWithVariant.id)).version, draftWithVariant.version + 1);
    });

    it('archives and returns to draft, and asking twice changes nothing the second time', async () => {
      const [a, b] = [await product({ status: 'active' }), await product({ status: 'active' })];
      const first = await post('/admin/products/bulk-status', { ids: [a.id, b.id], status: 'archived' });
      assert.equal(first.body.updated.length, 2);
      assert.deepEqual([await row(a.id).then((r) => r.status), await row(b.id).then((r) => r.status)], ['archived', 'archived']);
      const again = await post('/admin/products/bulk-status', { ids: [a.id, b.id], status: 'archived' });
      assert.deepEqual([again.body.updated.length, again.body.unchanged.length], [0, 2]);
      assert.equal((await row(a.id)).version, first.body.updated.find((u: Json) => u.id === a.id).version, 'nothing was written the second time');
      const back = await post('/admin/products/bulk-status', { ids: [a.id], status: 'draft' });
      assert.equal(back.body.updated[0].previousStatus, 'archived');
      assert.equal((await row(a.id)).status, 'draft');
    });

    it('counts each product once however often it is listed', async () => {
      const p = await product();
      const res = await post('/admin/products/bulk-status', { ids: [p.id, p.id, p.id], status: 'active' });
      assert.equal(res.body.requested, 1);
      assert.equal(res.body.updated.length, 1);
    });

    it('writes one audit entry for the whole change, and none when nothing changed', async () => {
      const ps = await Promise.all([product(), product(), product()]);
      const count = async () => (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'product.bulk_status'))).length;
      const before = await count();
      await post('/admin/products/bulk-status', { ids: ps.map((p) => p.id), status: 'active' });
      assert.equal((await count()) - before, 1);
      await post('/admin/products/bulk-status', { ids: ps.map((p) => p.id), status: 'active' });
      assert.equal((await count()) - before, 1, 'no change, no entry');
      const [entry] = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'product.bulk_status'))).slice(-1);
      assert.deepEqual([...((entry!.afterJson as Json).updated as string[])].sort(), ps.map((p) => p.id).sort());
    });

    it('takes up to 500 in one request, and refuses more, none, or nonsense', async () => {
      const ids = (await Promise.all(Array.from({ length: 40 }, () => product()))).map((p) => p.id);
      const many = [...ids, ...Array.from({ length: 460 }, (_, i) => `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`)];
      const res = await post('/admin/products/bulk-status', { ids: many, status: 'active' });
      assert.equal(res.status, 200);
      assert.equal(res.body.updated.length, 40);
      assert.equal(res.body.missing.length, 460);
      assert.equal((await post('/admin/products/bulk-status', { ids: [...many, MISSING], status: 'active' })).status, 422, '501 is too many');
      assert.equal((await post('/admin/products/bulk-status', { ids: [], status: 'active' })).status, 422);
      assert.equal((await post('/admin/products/bulk-status', { ids: ['nope'], status: 'active' })).status, 422);
      assert.equal((await post('/admin/products/bulk-status', { ids: [MISSING], status: 'deleted' })).status, 422);
    });

    it('is for people who can write the catalogue', async () => {
      const p = await product();
      assert.equal((await post('/admin/products/bulk-status', { ids: [p.id], status: 'active' }, support)).status, 403);
      assert.equal((await row(p.id)).status, 'draft');
    });

    it('lets two overlapping bulk changes run together without deadlocking', async () => {
      const ps = await Promise.all(Array.from({ length: 30 }, () => product()));
      const ids = ps.map((p) => p.id);
      const results = await Promise.all([post('/admin/products/bulk-status', { ids, status: 'active' }), post('/admin/products/bulk-status', { ids: [...ids].reverse(), status: 'archived' })]);
      assert.deepEqual(results.map((r) => r.status), [200, 200]);
      const final = new Set((await t.db.select({ s: products.status }).from(products).where(inArray(products.id, ids))).map((r) => r.s));
      assert.equal(final.size, 1, 'one change landed after the other, as a whole');
    });
  });

  describe('categories', () => {
    const cat = async (active = true) => {
      const n = ++seq;
      const [c] = await t.db.insert(categories).values({ slug: `bulk-cat-${n}`, name: `Bulk cat ${n}`, active }).returning();
      return c!;
    };
    const crow = async (id: string) => (await t.db.select().from(categories).where(eq(categories.id, id)))[0]!;

    it('hides and shows many at once and reports unchanged and missing ones', async () => {
      const [a, b, c] = [await cat(), await cat(), await cat(false)];
      const hide = await post('/admin/categories/bulk-status', { ids: [a.id, b.id, c.id, MISSING], active: false });
      assert.equal(hide.status, 200);
      assert.deepEqual(hide.body.updated.map((u: Json) => u.id).sort(), [a.id, b.id].sort());
      assert.deepEqual(hide.body.unchanged, [c.id]);
      assert.deepEqual(hide.body.missing, [MISSING]);
      assert.equal((await crow(a.id)).active, false);
      assert.equal((await crow(a.id)).version, a.version + 1);
      assert.equal((await crow(c.id)).version, c.version, 'already hidden: not touched');
      const show = await post('/admin/categories/bulk-status', { ids: [a.id, b.id], active: true });
      assert.equal(show.body.updated.length, 2);
      assert.equal((await crow(b.id)).active, true);
    });

    it('validates, requires catalogue write access, and audits once', async () => {
      const [a, b] = [await cat(), await cat()];
      assert.equal((await post('/admin/categories/bulk-status', { ids: [a.id], active: false }, support)).status, 403);
      assert.equal((await post('/admin/categories/bulk-status', { ids: [], active: false })).status, 422);
      assert.equal((await post('/admin/categories/bulk-status', { ids: [a.id], active: 'no' })).status, 422);
      const entries = async () => (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'category.bulk_status'))).length;
      const before = await entries();
      await post('/admin/categories/bulk-status', { ids: [a.id, b.id], active: false });
      assert.equal((await entries()) - before, 1, 'one entry for the whole change');
    });
  });
});
