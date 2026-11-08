import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { adminAuditLog, collections, deliveryZones, inventory, productCollections, productVariants, products, promotions } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';
import { runMaintenance } from '../../../worker/maintenance.js';

type Json = Record<string, any>;
const day = 86_400_000;

describe('admin promotions', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let manager: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;
  let variantId = '';
  let productId = '';

  const call = async (method: string, url: string, payload?: Json, who = owner) => {
    const res = await api.inject({ method: method as 'GET', url: `/api/v1${url}`, ...(payload ? { payload } : {}), headers: who.headers });
    return { status: res.statusCode, body: res.result as Json };
  };
  const quote = async (promotionCodes: string[] = []) => {
    const res = await api.inject({ method: 'POST', url: '/api/v1/pricing/quote', payload: { items: [{ variantId, quantity: 2 }], promotionCodes } });
    return res.result as Json;
  };
  const percent = (over: Json = {}) => ({ name: 'Ten off', kind: 'percentage', configuration: { version: 1, percent: 10 }, ...over });

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    manager = await signInAdmin(t.db, api, 'manager');
    support = await signInAdmin(t.db, api, 'support');
    const [p] = await t.db.insert(products).values({ slug: 'promo-wig', title: 'Promo Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: 'PROMO-1', optionSignature: {}, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: 50 });
    variantId = v!.id;
    productId = p!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', deliveryFeeMinor: 150000 });
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  it('is restricted to roles that can write promotions', async () => {
    assert.equal((await call('GET', '/admin/promotions', undefined, support)).status, 403);
    assert.equal((await call('POST', '/admin/promotions', percent(), support)).status, 403);
    assert.equal((await call('GET', '/admin/promotions', undefined, manager)).status, 200);
  });

  it('creates a free-gift promotion that names its gift, and says what the gift is when read back', async () => {
    const made = await call('POST', '/admin/promotions', percent({ name: 'Free gift', kind: 'free_gift', configuration: { version: 1, variantId, quantity: 2 }, codes: [{ code: 'GIFT22' }] }));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual([made.body.gift.variantId, made.body.gift.sku, made.body.gift.quantity], [variantId, 'PROMO-1', 2]);
    assert.equal(typeof made.body.gift.productTitle, 'string');
    const other = await call('GET', `/admin/promotions/${(await call('POST', '/admin/promotions', percent({ name: 'Plain' }))).body.promotion.id}`);
    assert.equal(other.body.gift, null, 'other kinds have no gift');
    // Changing the gift to something that does not exist is refused when editing too.
    const bad = await call('PATCH', `/admin/promotions/${made.body.promotion.id}`, { configuration: { version: 1, variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 } });
    assert.equal(bad.status, 422);
  });

  it('validates rules against the pricing engine schemas', async () => {
    const bad = [
      percent({ configuration: { version: 1, percent: 150 } }),
      percent({ configuration: { percent: 10 } }),
      percent({ kind: 'fixed_amount' }),
      percent({ kind: 'free_gift', configuration: { version: 1 } }), // a gift has to name a variant
      percent({ kind: 'free_gift', configuration: { version: 1, variantId: '00000000-0000-4000-8000-000000000000' } }), // that exists
      percent({ scope: { include: { productIds: ['00000000-0000-4000-8000-000000000000'] } } }),
      percent({ startsAt: new Date(Date.now() + day), endsAt: new Date() }),
      percent({ codes: [{ code: 'x' }] }),
      percent({ codes: [{ code: 'DUP' }, { code: 'dup' }] }),
    ];
    for (const payload of bad) {
      const res = await call('POST', '/admin/promotions', payload);
      assert.equal(res.status, 422, JSON.stringify(payload));
    }
    assert.equal((await call('POST', '/admin/promotions', percent({ configuration: { version: 1, percent: 10, extra: 1 } }))).status, 422, 'unknown rule keys are refused');
  });

  it('creates a draft that does nothing until activated, then discounts the quote', async () => {
    const created = await call('POST', '/admin/promotions', percent({ scope: { include: { productIds: [productId] } } }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.promotion.lifecycle, 'draft');
    const id = created.body.promotion.id;
    assert.equal((await quote()).discountMinor, 0);

    const live = await call('POST', `/admin/promotions/${id}/activate`);
    assert.equal(live.body.promotion.lifecycle, 'live');
    assert.equal((await quote()).discountMinor, 20000, '10% of 2 x 1000.00');

    const edited = await call('PATCH', `/admin/promotions/${id}`, { configuration: { version: 1, percent: 25 } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal((await quote()).discountMinor, 50000);

    await call('POST', `/admin/promotions/${id}/deactivate`);
    assert.equal((await quote()).discountMinor, 0);
    const actions = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, id))).map((a) => a.action).sort();
    assert.deepEqual(actions, ['promotion.activate', 'promotion.create', 'promotion.deactivate', 'promotion.update']);
  });

  it('creates code promotions with normalised codes that only apply when entered', async () => {
    const res = await call('POST', '/admin/promotions', { name: 'Welcome', kind: 'fixed_amount', configuration: { version: 1, amountMinor: 5000 }, minimumSubtotalMinor: 100000, codes: [{ code: ' welcome5 ', maxRedemptions: 100 }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.codes[0].code, 'WELCOME5');
    const id = res.body.promotion.id;
    await call('POST', `/admin/promotions/${id}/activate`);
    assert.equal((await quote()).discountMinor, 0, 'not applied without the code');
    assert.equal((await quote(['welcome5'])).discountMinor, 5000);

    const clash = await call('POST', '/admin/promotions', { name: 'Other', kind: 'fixed_amount', configuration: { version: 1, amountMinor: 1 }, codes: [{ code: 'WELCOME5' }] });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'CODE_TAKEN');

    const patched = await call('PATCH', `/admin/promotions/${id}`, { codes: [{ code: 'WELCOME5', active: false }, { code: 'SPRING10' }] });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.deepEqual(patched.body.codes.map((c: Json) => [c.code, c.active]), [['SPRING10', true], ['WELCOME5', false]]);
    assert.equal((await quote(['WELCOME5'])).discountMinor, 0, 'a deactivated code stops working');
    assert.equal((await quote(['spring10'])).discountMinor, 5000);

    // A code that belongs to another promotion can never be taken over through PATCH.
    const other = await call('POST', '/admin/promotions', percent({ name: 'Third' }));
    const steal = await call('PATCH', `/admin/promotions/${other.body.promotion.id}`, { codes: [{ code: 'SPRING10', active: false }] });
    assert.equal(steal.status, 409);
    assert.equal((await quote(['spring10'])).discountMinor, 5000);
  });

  it('will not turn a live automatic promotion into a code-only one', async () => {
    const created = await call('POST', '/admin/promotions', percent({ name: 'Auto' }));
    const id = created.body.promotion.id;
    await call('POST', `/admin/promotions/${id}/activate`);
    const res = await call('PATCH', `/admin/promotions/${id}`, { codes: [{ code: 'NOWCODE' }] });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PROMOTION_LIVE');
    await call('POST', `/admin/promotions/${id}/deactivate`);
    assert.equal((await call('PATCH', `/admin/promotions/${id}`, { codes: [{ code: 'NOWCODE' }] })).status, 200);
  });

  it('derives schedule status, enforces the window, and expires ended promotions', async () => {
    const future = await call('POST', '/admin/promotions', percent({ name: 'Flash', startsAt: new Date(Date.now() + day), endsAt: new Date(Date.now() + 2 * day) }));
    await call('POST', `/admin/promotions/${future.body.promotion.id}/activate`);
    const listed = await call('GET', '/admin/promotions?status=scheduled');
    assert.ok(listed.body.data.some((p: Json) => p.id === future.body.promotion.id));

    const soon = await call('POST', '/admin/promotions', percent({ name: 'Ends soon' }));
    await call('POST', `/admin/promotions/${soon.body.promotion.id}/activate`);
    await t.db.update(promotions).set({ startsAt: new Date(Date.now() - 2 * day), endsAt: new Date(Date.now() - day) }).where(eq(promotions.id, soon.body.promotion.id));
    assert.equal((await call('GET', `/admin/promotions/${soon.body.promotion.id}`)).body.promotion.lifecycle, 'ended');
    assert.equal((await call('POST', `/admin/promotions/${soon.body.promotion.id}/activate`)).status, 409);
    assert.equal((await call('PATCH', `/admin/promotions/${soon.body.promotion.id}`, { name: 'Renamed' })).status, 409, 'edits need a new end date');

    const result = await runMaintenance(t.db, createLogger('error'));
    assert.ok(result.promotionsExpired >= 1);
    assert.equal((await t.db.select().from(promotions).where(eq(promotions.id, soon.body.promotion.id)))[0]!.status, 'expired');

    const revived = await call('PATCH', `/admin/promotions/${soon.body.promotion.id}`, { endsAt: new Date(Date.now() + day) });
    assert.equal(revived.status, 200, JSON.stringify(revived.body));
    assert.equal((await call('POST', `/admin/promotions/${soon.body.promotion.id}/activate`)).body.promotion.lifecycle, 'live');
  });

  it('lists with search and paging', async () => {
    const page = await call('GET', '/admin/promotions?limit=2');
    assert.equal(page.body.data.length, 2);
    assert.ok(page.body.page.nextCursor);
    const next = await call('GET', `/admin/promotions?limit=2&cursor=${page.body.page.nextCursor}`);
    assert.ok(next.body.data.every((p: Json) => !page.body.data.some((q: Json) => q.id === p.id)));
    assert.equal((await call('GET', '/admin/promotions?q=welcome')).body.data[0].name, 'Welcome');
    assert.equal((await call('GET', '/admin/promotions?q=spring10')).body.data[0].type, 'code');
    assert.equal((await call('GET', '/admin/promotions/00000000-0000-4000-8000-000000000000')).status, 404);
  });

  describe('attaching a promotion to a product', () => {
    let otherId = '';
    let collectionId = '';
    const forProduct = async (who = owner) => call('GET', `/admin/products/${productId}/promotions`, undefined, who);
    const relationOf = async (promotionId: string) => (await forProduct()).body.data.find((p: Json) => p.id === promotionId)?.relation;
    // Drafts are not listed for a product, so these are switched on (an ended promotion cannot be).
    const make = async (name: string, over: Json = {}, activate = true) => {
      const id = (await call('POST', '/admin/promotions', percent({ name, ...over }))).body.promotion.id as string;
      if (activate) assert.equal((await call('POST', `/admin/promotions/${id}/activate`)).status, 200);
      return id;
    };

    before(async () => {
      const [o] = await t.db.insert(products).values({ slug: 'attach-other', title: 'Other Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
      otherId = o!.id;
      const [c] = await t.db.insert(collections).values({ slug: 'attach-col', name: 'Attach collection' }).returning();
      collectionId = c!.id;
      await t.db.insert(productCollections).values({ productId, collectionId });
    });

    it('says how each promotion relates to the product, and leaves out free delivery', async () => {
      const everyone = await make('For everyone');
      const named = await make('Named', { scope: { include: { productIds: [productId] } } });
      const viaCollection = await make('Via collection', { scope: { include: { collectionIds: [collectionId] } } });
      const elsewhere = await make('Elsewhere', { scope: { include: { productIds: [otherId] } } });
      const except = await make('Except', { scope: { excludeProductIds: [productId] } });
      const delivery = await make('Free delivery', { kind: 'free_delivery', configuration: { version: 1 } });
      const rows = (await forProduct()).body.data as Json[];
      const rel = (id: string) => rows.find((r) => r.id === id)?.relation;
      assert.equal(rel(everyone), 'all');
      assert.equal(rel(named), 'attached');
      assert.equal(rel(viaCollection), 'collection');
      assert.equal(rel(elsewhere), 'available');
      assert.equal(rel(except), 'excluded');
      assert.equal(rows.some((r) => r.id === delivery), false, 'free delivery has no product scope');
      assert.equal(rows.find((r) => r.id === named)?.removable, false, 'it is the only thing the promotion names');
    });

    it('does not list drafts, which are still being written in Promotions', async () => {
      const draft = await make('Still a draft', { scope: { include: { productIds: [otherId] } } }, false);
      assert.equal(((await forProduct()).body.data as Json[]).some((p) => p.id === draft), false);
      assert.equal((await call('POST', `/admin/promotions/${draft}/activate`)).status, 200);
      assert.equal(await relationOf(draft), 'available', 'listed once it is switched on');
    });

    it('attaches the product to a limited promotion, and keeps its other products', async () => {
      const id = await make('Limited', { scope: { include: { productIds: [otherId] } } });
      assert.equal(await relationOf(id), 'available');
      const res = await call('PUT', `/admin/products/${productId}/promotions/${id}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.find((p: Json) => p.id === id).relation, 'attached');
      const scope = (await call('GET', `/admin/promotions/${id}`)).body.promotion.scope;
      assert.deepEqual([...scope.include.productIds].sort(), [otherId, productId].sort());
      // Attaching twice changes nothing.
      assert.equal((await call('PUT', `/admin/products/${productId}/promotions/${id}`)).status, 200);
      assert.equal(((await call('GET', `/admin/promotions/${id}`)).body.promotion.scope.include.productIds as string[]).length, 2);
      const audit = await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, id));
      assert.ok(audit.some((a) => a.action === 'promotion.attach_product'));
    });

    it('lifts a named exception when the product is attached', async () => {
      const id = await make('Exception then attach', { scope: { include: { productIds: [otherId] }, excludeProductIds: [productId] } });
      assert.equal(await relationOf(id), 'excluded');
      assert.equal((await call('PUT', `/admin/products/${productId}/promotions/${id}`)).status, 200);
      const scope = (await call('GET', `/admin/promotions/${id}`)).body.promotion.scope;
      assert.equal(scope.excludeProductIds, undefined);
      assert.equal(await relationOf(id), 'attached');
    });

    it('refuses what would quietly change who gets a promotion', async () => {
      const everyone = await make('Everyone again');
      const refused = await call('PUT', `/admin/products/${productId}/promotions/${everyone}`);
      assert.equal(refused.status, 422);
      assert.match(JSON.stringify(refused.body), /already applies to every product/);
      assert.equal((await call('GET', `/admin/promotions/${everyone}`)).body.promotion.scope.include, undefined, 'its scope is unchanged');

      const delivery = await make('Delivery', { kind: 'free_delivery', configuration: { version: 1 } });
      assert.equal((await call('PUT', `/admin/products/${productId}/promotions/${delivery}`)).status, 422);
      const ended = await make('Ended', { scope: { include: { productIds: [otherId] } }, startsAt: new Date(Date.now() - 3 * day).toISOString(), endsAt: new Date(Date.now() - day).toISOString() }, false);
      assert.equal((await call('PUT', `/admin/products/${productId}/promotions/${ended}`)).status, 409);
      assert.equal((await call('PUT', `/admin/products/00000000-0000-4000-8000-000000000000/promotions/${everyone}`)).status, 404);
      assert.equal((await call('PUT', `/admin/products/${productId}/promotions/00000000-0000-4000-8000-000000000000`)).status, 404);
    });

    it('takes the product off, but never leaves a promotion with nothing chosen (which would mean every product)', async () => {
      const id = await make('Two products', { scope: { include: { productIds: [productId, otherId] } } });
      assert.equal((await forProduct()).body.data.find((p: Json) => p.id === id).removable, true);
      const removed = await call('DELETE', `/admin/products/${productId}/promotions/${id}`);
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.equal(removed.body.data.find((p: Json) => p.id === id).relation, 'available');
      assert.deepEqual((await call('GET', `/admin/promotions/${id}`)).body.promotion.scope.include.productIds, [otherId]);

      const only = await make('Only this one', { scope: { include: { productIds: [productId] } } });
      const widening = await call('DELETE', `/admin/products/${productId}/promotions/${only}`);
      assert.equal(widening.status, 409);
      assert.equal(widening.body.error.code, 'PROMOTION_WOULD_WIDEN');
      assert.equal(await relationOf(only), 'attached', 'nothing changed');

      // A promotion that names a collection as well can lose a product, and the collection stays.
      const mixed = await make('Product and collection', { scope: { include: { productIds: [productId], collectionIds: [collectionId] } } });
      assert.equal((await call('DELETE', `/admin/products/${productId}/promotions/${mixed}`)).status, 200);
      assert.deepEqual((await call('GET', `/admin/promotions/${mixed}`)).body.promotion.scope.include, { collectionIds: [collectionId] });

      const notNamed = await call('DELETE', `/admin/products/${productId}/promotions/${id}`);
      assert.equal(notNamed.status, 422, 'it is no longer on the promotion');
    });

    it('needs permission to read, and to write', async () => {
      assert.equal((await forProduct(support)).status, 403);
      const id = await make('Guarded', { scope: { include: { productIds: [otherId] } } });
      assert.equal((await call('PUT', `/admin/products/${productId}/promotions/${id}`, undefined, support)).status, 403);
      assert.equal((await call('DELETE', `/admin/products/${productId}/promotions/${id}`, undefined, support)).status, 403);
    });
  });
});
