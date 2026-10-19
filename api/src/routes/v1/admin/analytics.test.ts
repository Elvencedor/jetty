import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { analyticsEvents, categories, orderItems, orders, productCategories, products } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { createServer } from '../../../server.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';

type Json = Record<string, any>;
const day = 86_400_000;

describe('admin dashboard and analytics', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;
  let manager: Awaited<ReturnType<typeof signInAdmin>>;
  const ids: Record<string, string> = {};
  let n = 0;
  // A fixed "now" keeps bucket maths deterministic: noon UTC on 2026-06-30.
  const NOW = new Date('2026-06-30T12:00:00Z');
  const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * day);

  const call = async (url: string, who = owner) => {
    const res = await api.inject({ url: `/api/v1${url}`, headers: who.headers });
    return { status: res.statusCode, body: res.result as Json };
  };
  const q = (from: Date, to: Date) => `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;

  async function sale(daysAgo: number, product: string, total: number, over: Partial<typeof orders.$inferInsert> = {}) {
    const [o] = await t.db
      .insert(orders)
      .values({ orderNumber: `JH-A-${++n}`, phoneE164: '+2348000000000', subtotalMinor: total, totalMinor: total, deliveryAddressSnapshot: {}, deliveryMethod: 'next_day', termsAcceptedAt: new Date(), status: 'placed', paymentStatus: 'paid', placedAt: at(daysAgo), ...over })
      .returning();
    await t.db.insert(orderItems).values({ orderId: o!.id, productId: ids[product]!, skuSnapshot: product, titleSnapshot: product, quantity: 1, unitPriceMinor: total, lineTotalMinor: total });
    return o!;
  }

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    support = await signInAdmin(t.db, api, 'support');
    manager = await signInAdmin(t.db, api, 'manager');
    for (const slug of ['alpha', 'beta']) ids[slug] = (await t.db.insert(products).values({ slug, title: slug, status: 'active' }).returning())[0]!.id;
    const [cat] = await t.db.insert(categories).values({ slug: 'analytics-cat', name: 'Analytics Cat' }).returning();
    await t.db.insert(productCategories).values({ productId: ids['alpha']!, categoryId: cat!.id });

    // Current period: the 10 days up to NOW. Previous period: the 10 days before that.
    await sale(1, 'alpha', 200000);
    await sale(1, 'alpha', 100000);
    await sale(5, 'beta', 300000);
    await sale(3, 'alpha', 999999, { paymentStatus: 'refunded', status: 'refunded' });
    await sale(2, 'alpha', 888888, { paymentStatus: 'pending', status: 'pending_payment', placedAt: null });
    await sale(14, 'alpha', 150000);
    await sale(15, 'beta', 150000);
    await sale(12, 'beta', 300000);
    await sale(40, 'beta', 777777); // outside both periods

    const ev = (session: string, name: string, daysAgo: number) => ({ eventName: name, anonymousId: `anon-${session}`, sessionId: session, occurredAt: at(daysAgo) });
    await t.db.insert(analyticsEvents).values([
      ...['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12'].map((s) => ev(s, 'session_start', 2)),
      ev('s1', 'product_view', 2),
      ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((s) => ev(s, 'session_start', 12)),
    ]);
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  const range = () => q(at(10), NOW);

  it('is limited to roles that can read analytics', async () => {
    assert.equal((await call(`/admin/dashboard?${range()}`, support)).status, 403);
    assert.equal((await call(`/admin/dashboard?${range()}`, manager)).status, 200);
    assert.equal((await api.inject({ url: '/api/v1/admin/dashboard' })).statusCode, 401);
  });

  it('reports KPIs against the previous period, counting only paid, non-refunded sales', async () => {
    const { status, body } = await call(`/admin/dashboard?${range()}`);
    assert.equal(status, 200, JSON.stringify(body));
    const k = body.kpis;
    assert.deepEqual([k.revenueMinor.current, k.revenueMinor.previous, k.revenueMinor.changePct], [600000, 600000, 0]);
    assert.deepEqual([k.orders.current, k.orders.previous], [3, 3]);
    assert.equal(k.averageOrderValueMinor.current, 200000);
    assert.equal(k.averageOrderValueMinor.previous, 200000);
    assert.deepEqual([k.sessions.current, k.sessions.previous], [12, 8]);
    assert.equal(k.conversionRatePct.current, 25, '3 orders / 12 sessions');
    assert.equal(k.conversionRatePct.previous, 37.5);
    assert.equal(body.range.previous.to, at(10).toISOString());
  });

  it('ranks products and sums sales by category', async () => {
    const { body } = await call(`/admin/dashboard?${range()}`);
    assert.deepEqual(body.topProducts.map((p: Json) => [p.title, p.units, p.revenueMinor]), [['alpha', 2, 300000], ['beta', 1, 300000]], 'equal revenue ranks by units');
    const full = await call(`/admin/analytics/products?${range()}`);
    assert.deepEqual(full.body.salesByCategory.map((c: Json) => [c.name, c.revenueMinor]), [['Analytics Cat', 300000]]);
  });

  it('builds a gap-free revenue series with the previous period alongside', async () => {
    const { status, body } = await call(`/admin/analytics/revenue?${range()}&interval=day`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.current.length, 11, '10 days of range spans 11 Lagos-local dates');
    assert.equal(body.current.reduce((s: number, p: Json) => s + p.revenueMinor, 0), 600000);
    assert.equal(body.previous.reduce((s: number, p: Json) => s + p.revenueMinor, 0), 600000);
    assert.ok(body.current.every((p: Json) => typeof p.bucket === 'string'));
    assert.equal(body.current.find((p: Json) => p.bucket === '2026-06-29').revenueMinor, 300000);
    assert.equal(body.current.filter((p: Json) => p.revenueMinor === 0).length >= 8, true, 'quiet days appear as zero');

    const weekly = await call(`/admin/analytics/revenue?${q(at(27), NOW)}&interval=week`);
    assert.equal(weekly.body.current.reduce((s: number, p: Json) => s + p.revenueMinor, 0), 1200000);
    assert.ok(weekly.body.current.every((p: Json) => new Date(`${p.bucket}T00:00:00Z`).getUTCDay() === 1), 'weeks start on Monday');
    const monthly = await call(`/admin/analytics/revenue?${q(new Date('2026-04-30T23:00:00Z'), new Date('2026-06-30T23:00:00Z'))}&interval=month`);
    assert.deepEqual(monthly.body.current.map((p: Json) => p.bucket), ['2026-05-01', '2026-06-01']);
  });

  it('validates ranges and reports no conversion when no events exist', async () => {
    assert.equal((await call(`/admin/dashboard?${q(NOW, at(1))}`)).status, 422, 'from after to');
    assert.equal((await call(`/admin/dashboard?${q(at(500), NOW)}`)).status, 422, 'more than a year');
    assert.equal((await call('/admin/analytics/revenue?interval=hour')).status, 422);
    const quiet = await call(`/admin/dashboard?${q(at(300), at(290))}`);
    assert.equal(quiet.body.kpis.conversionRatePct.current, null);
    assert.equal(quiet.body.kpis.orders.current, 0);
    assert.equal(quiet.body.kpis.averageOrderValueMinor.current, 0);
    assert.equal(quiet.body.kpis.revenueMinor.changePct, null, 'no baseline, no percentage');
  });

  it('counts orders awaiting action', async () => {
    await sale(0, 'alpha', 1, { status: 'packed' });
    await sale(0, 'alpha', 1, { status: 'out_for_delivery' });
    await sale(0, 'alpha', 1, { status: 'payment_exception' });
    const counts = (await call('/admin/orders-to-action')).body;
    assert.equal(counts.toPack >= 3, true);
    assert.deepEqual([counts.toDispatch, counts.outForDelivery, counts.paymentExceptions], [1, 1, 1]);
    assert.equal(counts.awaitingTransfer, 0);
  });

  describe('event ingestion', () => {
    const post = (payload: Json) => api.inject({ method: 'POST', url: '/api/v1/analytics/events', payload });
    const event = (over: Json = {}) => ({ name: 'product_view', anonymousId: 'anon-12345678', sessionId: 'sess-12345678', properties: { productId: '00000000-0000-4000-8000-000000000001' }, ...over });

    it('accepts allow-listed funnel events from anonymous visitors', async () => {
      const before = (await t.db.select().from(analyticsEvents)).length;
      assert.equal((await post({ events: [event(), event({ name: 'add_to_bag', properties: { variantId: '00000000-0000-4000-8000-000000000002', quantity: 2 } })] })).statusCode, 204);
      assert.equal((await t.db.select().from(analyticsEvents)).length, before + 2);
    });

    it('rejects purchase events, arbitrary properties, oversized batches and future timestamps', async () => {
      for (const payload of [
        { events: [event({ name: 'purchase' })] },
        { events: [event({ properties: { creditCard: '4111' } })] },
        { events: Array.from({ length: 21 }, () => event()) },
        { events: [] },
        { events: [event({ occurredAt: new Date(Date.now() + 3600_000).toISOString() })] },
        { events: [event({ sessionId: 'x' })] },
      ]) assert.equal((await post(payload)).statusCode, 422, JSON.stringify(payload).slice(0, 80));
    });
  });
});
