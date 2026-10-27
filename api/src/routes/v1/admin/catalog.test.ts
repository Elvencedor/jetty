import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { adminAuditLog, inventory, inventoryMovements, orders, stockReservations } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { S3Storage } from '../../../modules/media/storage.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';
import { FakeStorage } from '../../../testing/fake-storage.js';

type Json = Record<string, any>;

describe('admin catalog, media and inventory', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let bare: Server;
  const storage = new FakeStorage();
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;
  let editor: Awaited<ReturnType<typeof signInAdmin>>;

  const call = async (method: string, url: string, payload?: Json, who = owner, headers: Record<string, string> = {}) => {
    // Variant matrix saves need the product's current ETag; fetch it unless the caller is testing the precondition itself.
    if (method === 'PUT' && url.endsWith('/variants') && !('if-match' in headers)) {
      const current = await api.inject({ url: `/api/v1${url.replace(/\/variants$/, '')}`, headers: who.headers });
      headers = { ...headers, 'if-match': current.headers.etag as string };
    }
    const res = await api.inject({ method: method as 'GET', url: `/api/v1${url}`, ...(payload ? { payload } : {}), headers: { ...who.headers, ...headers } });
    return { status: res.statusCode, body: res.result as Json, etag: res.headers.etag as string | undefined };
  };

  const matrix = {
    options: [
      { name: 'Length', values: [{ label: '14"', valueKey: '14' }, { label: '20"', valueKey: '20', priceDeltaMinor: 20000 }] },
      { name: 'Lace', values: [{ label: 'HD', valueKey: 'hd' }] },
    ],
    variants: [
      { sku: 'BW-14-HD', optionValues: { Length: '14', Lace: 'hd' }, priceMinor: 100000, stock: 5 },
      { sku: 'BW-20-HD', optionValues: { Length: '20', Lace: 'hd' }, priceMinor: 120000, compareAtPriceMinor: 150000, stock: 3 },
    ],
  };

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, storage });
    await api.initialize();
    bare = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
    await bare.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    support = await signInAdmin(t.db, api, 'support');
    editor = await signInAdmin(t.db, api, 'content_editor');
  });
  after(async () => {
    await api?.stop();
    await bare?.stop();
    await t?.destroy();
  });

  describe('products', () => {
    let id = '';
    let etag = '';

    it('enforces permissions: reading needs catalog:read, writing catalog:write, and anonymous is refused', async () => {
      assert.equal((await api.inject({ url: '/api/v1/admin/products' })).statusCode, 401);
      assert.equal((await call('GET', '/admin/products', undefined, support)).status, 403, 'support has no catalog access');
      assert.equal((await call('GET', '/admin/products', undefined, editor)).status, 200, 'content editors can read');
      assert.equal((await call('POST', '/admin/products', { title: 'x' }, editor)).status, 403, 'but not write');
    });

    it('creates a draft with a generated unique slug and returns an ETag', async () => {
      const a = await call('POST', '/admin/products', { title: 'Body Wave Frontal' });
      assert.equal(a.status, 201, JSON.stringify(a.body));
      assert.equal(a.body.product.slug, 'body-wave-frontal');
      assert.equal(a.body.product.status, 'draft');
      assert.ok(a.etag);
      id = a.body.product.id;
      etag = a.etag!;
      const b = await call('POST', '/admin/products', { title: 'Body Wave Frontal' });
      assert.equal(b.body.product.slug, 'body-wave-frontal-2');
      assert.equal((await call('POST', '/admin/products', { title: 'Other', slug: 'body-wave-frontal' })).status, 409);
    });

    it('requires If-Match for edits and rejects stale ones', async () => {
      assert.equal((await call('PATCH', `/admin/products/${id}`, { description: 'Soft' })).status, 428);
      assert.equal((await call('PATCH', `/admin/products/${id}`, { description: 'Soft' }, owner, { 'if-match': '"1"' })).status, 412);
      const ok = await call('PATCH', `/admin/products/${id}`, { description: 'Soft and full', featured: true, seoTitle: '' }, owner, { 'if-match': etag });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.product.description, 'Soft and full');
      assert.equal(ok.body.product.seoTitle, null, 'blank clears the field');
      assert.notEqual(ok.etag, etag);
      assert.equal((await call('PATCH', `/admin/products/${id}`, { description: 'again' }, owner, { 'if-match': etag })).status, 412, 'the old ETag is now stale');
      etag = ok.etag!;
    });

    it('requires If-Match to replace the variant matrix and rejects a stale one', async () => {
      const p = await call('POST', '/admin/products', { title: 'Etag Wig' });
      const pid = p.body.product.id as string;
      const bare = await api.inject({ method: 'PUT', url: `/api/v1/admin/products/${pid}/variants`, payload: { options: [], variants: [{ sku: 'ETAG-1', priceMinor: 1000 }] }, headers: owner.headers });
      assert.equal(bare.statusCode, 428);
      const stale = await call('PUT', `/admin/products/${pid}/variants`, { options: [], variants: [{ sku: 'ETAG-1', priceMinor: 1000 }] }, owner, { 'if-match': '"1"' });
      assert.equal(stale.status, 412);
      assert.equal((await call('PUT', `/admin/products/${pid}/variants`, { options: [], variants: [{ sku: 'ETAG-1', priceMinor: 1000 }] })).status, 200);
    });

    it('cannot publish without a variant, then publishes after the matrix is set and becomes visible', async () => {
      const early = await call('POST', `/admin/products/${id}/publish`, {});
      assert.equal(early.status, 422);
      assert.equal(early.body.error.code, 'PRODUCT_NOT_PUBLISHABLE');

      const put = await call('PUT', `/admin/products/${id}/variants`, matrix);
      assert.equal(put.status, 200, JSON.stringify(put.body));
      assert.equal(put.body.variants.length, 2);
      assert.deepEqual(put.body.variants[0].stock, { onHand: 5, reserved: 0, available: 5, lowStockThreshold: null });
      const [movement] = await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, put.body.variants[0].id));
      assert.equal(movement!.reason, 'initial_stock');

      assert.equal((await api.inject({ url: '/api/v1/products/body-wave-frontal' })).statusCode, 404, 'a draft is not public');
      const published = await call('POST', `/admin/products/${id}/publish`, {});
      assert.equal(published.status, 200, JSON.stringify(published.body));
      assert.equal(published.body.product.status, 'active');
      const live = await api.inject({ url: '/api/v1/products/body-wave-frontal' });
      assert.equal(live.statusCode, 200);
      const data = (live.result as Json).data;
      assert.equal(data.variants.length, 2);
      assert.deepEqual(data.options.map((o: Json) => o.name), ['Length', 'Lace']);
      assert.equal(data.variants.find((v: Json) => v.sku === 'BW-20-HD').compareAtPrice.amountMinor, 150000);
    });

    it('updates the matrix: matches by combination, deactivates what is left out, revives by SKU, and validates', async () => {
      const before = (await call('GET', `/admin/products/${id}`)).body;
      const v14 = before.variants.find((v: Json) => v.sku === 'BW-14-HD');
      const only14 = { ...matrix, variants: [{ ...matrix.variants[0], priceMinor: 110000 }] };
      const res = await call('PUT', `/admin/products/${id}/variants`, only14);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const after14 = res.body.variants.find((v: Json) => v.sku === 'BW-14-HD');
      assert.equal(after14.id, v14.id, 'the same variant is updated in place');
      assert.equal(after14.priceMinor, 110000);
      assert.equal(after14.stock.onHand, 5, 'existing stock is untouched by a matrix save');
      assert.equal(res.body.variants.find((v: Json) => v.sku === 'BW-20-HD').active, false);
      assert.equal(((await api.inject({ url: '/api/v1/products/body-wave-frontal' })).result as Json).data.variants.length, 1);

      const back = await call('PUT', `/admin/products/${id}/variants`, matrix);
      assert.equal(back.status, 200, JSON.stringify(back.body));
      const revived = back.body.variants.find((v: Json) => v.sku === 'BW-20-HD');
      assert.equal(revived.active, true);
      assert.equal(back.body.variants.length, 2, 'revived, not duplicated');

      const dup = await call('PUT', `/admin/products/${id}/variants`, { ...matrix, variants: [matrix.variants[0], { ...matrix.variants[0], sku: 'OTHER' }] });
      assert.equal(dup.status, 422, 'same combination twice');
      const badCombo = await call('PUT', `/admin/products/${id}/variants`, { ...matrix, variants: [{ sku: 'X', optionValues: { Length: '99', Lace: 'hd' }, priceMinor: 1 }] });
      assert.equal(badCombo.status, 422);
      const badCompare = await call('PUT', `/admin/products/${id}/variants`, { ...matrix, variants: [{ ...matrix.variants[0], compareAtPriceMinor: 5 }] });
      assert.equal(badCompare.status, 422);
      const noneActive = await call('PUT', `/admin/products/${id}/variants`, { ...matrix, variants: [{ ...matrix.variants[0], active: false }] });
      assert.equal(noneActive.status, 422, 'a live product keeps an active variant');

      const other = await call('POST', '/admin/products', { title: 'Another' });
      const clash = await call('PUT', `/admin/products/${other.body.product.id}/variants`, { options: [], variants: [{ sku: 'bw-14-hd', priceMinor: 5 }] });
      assert.equal(clash.status, 409);
      assert.equal(clash.body.error.code, 'SKU_TAKEN');
    });

    it('keeps negative price differences and hidden values, and a hidden value is not offered to shoppers', async () => {
      const options = [
        { name: 'Length', values: [{ label: '14\"', valueKey: '14' }, { label: '20\"', valueKey: '20', priceDeltaMinor: 40000 }] },
        { name: 'Lace', values: [{ label: 'HD', valueKey: 'hd' }, { label: 'Closure', valueKey: 'closure', priceDeltaMinor: -20000 }, { label: 'Old lace', valueKey: 'old', active: false }] },
      ];
      const variants = [
        { sku: 'BW-14-HD', optionValues: { Length: '14', Lace: 'hd' }, priceMinor: 100000, stock: 5 },
        { sku: 'BW-14-CL', optionValues: { Length: '14', Lace: 'closure' }, priceMinor: 80000, stock: 2 },
        { sku: 'BW-14-OLD', optionValues: { Length: '14', Lace: 'old' }, priceMinor: 100000, active: false },
      ];
      const res = await call('PUT', `/admin/products/${id}/variants`, { options, variants });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const lace = res.body.options.find((o: Json) => o.name === 'Lace').values;
      assert.deepEqual(lace.map((v: Json) => [v.valueKey, v.priceDeltaMinor, v.active]), [['hd', 0, true], ['closure', -20000, true], ['old', 0, false]]);
      const publicLace = ((await api.inject({ url: '/api/v1/products/body-wave-frontal' })).result as Json).data.options.find((o: Json) => o.name === 'Lace').values;
      assert.ok(!publicLace.some((v: Json) => v.valueKey === 'old'), 'shoppers are not offered a hidden value');
      // Put the matrix back for the tests that follow.
      assert.equal((await call('PUT', `/admin/products/${id}/variants`, matrix)).status, 200);
    });

    it('lists and filters, archives, and writes an audit trail', async () => {
      const list = await call('GET', '/admin/products?q=frontal&status=active');
      assert.ok(list.body.summary.products >= 1 && list.body.summary.variants >= 2, 'the first page carries the catalogue summary');
      assert.equal(typeof list.body.summary.lowStock, 'number');
      assert.equal((await call('GET', `/admin/products?limit=1&cursor=${(await call('GET', '/admin/products?limit=1')).body.page.nextCursor}`)).body.summary, null, 'later pages skip it');
      assert.deepEqual(list.body.data.map((p: Json) => p.slug), ['body-wave-frontal']);
      assert.equal(list.body.data[0].variantCount, 2);
      assert.equal(list.body.data[0].availableQuantity, 8);
      assert.ok(list.body.data[0].maxPriceMinor >= list.body.data[0].minPriceMinor, 'cards can show a price range');
      const paged = await call('GET', '/admin/products?limit=1');
      assert.equal(paged.body.data.length, 1);
      const next = await call('GET', `/admin/products?limit=1&cursor=${paged.body.page.nextCursor}`);
      assert.notEqual(next.body.data[0].id, paged.body.data[0].id);

      const archived = await call('POST', `/admin/products/${id}/archive`, {});
      assert.equal(archived.body.product.status, 'archived');
      assert.equal((await api.inject({ url: '/api/v1/products/body-wave-frontal' })).statusCode, 404);
      const actions = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, id))).map((a) => a.action);
      for (const a of ['product.create', 'product.update', 'product.publish', 'product.variants.replace', 'product.archive']) assert.ok(actions.includes(a), a);
    });
  });

  describe('media', () => {
    let productId = '';
    before(async () => {
      productId = (await call('POST', '/admin/products', { title: 'Media Wig' })).body.product.id;
    });

    it('is unavailable without configured storage, and validates type and size', async () => {
      const res = await bare.inject({ method: 'POST', url: '/api/v1/admin/media/upload-intents', payload: { productId, contentType: 'image/png', sizeBytes: 10 }, headers: owner.headers });
      assert.equal(res.statusCode, 503);
      assert.equal((await call('POST', '/admin/media/upload-intents', { productId, contentType: 'image/gif', sizeBytes: 10 })).status, 422);
      assert.equal((await call('POST', '/admin/media/upload-intents', { productId, contentType: 'image/png', sizeBytes: 50_000_000 })).status, 422);
      assert.equal((await call('POST', '/admin/media/upload-intents', { productId: '00000000-0000-4000-8000-000000000000', contentType: 'image/png', sizeBytes: 10 })).status, 404);
    });

    it('issues a server-chosen key, finalises only after upload, and manages the cover', async () => {
      const intent = await call('POST', '/admin/media/upload-intents', { productId, contentType: 'image/webp', sizeBytes: 2048 });
      assert.equal(intent.status, 200, JSON.stringify(intent.body));
      const key = intent.body.objectKey as string;
      assert.match(key, new RegExp(`^products/${productId}/[0-9a-f-]{36}\\.webp$`));
      assert.equal(intent.body.upload.method, 'PUT');

      const early = await call('POST', `/admin/products/${productId}/media`, { objectKey: key, altText: 'Front view', angle: 'front' });
      assert.equal(early.status, 422);
      assert.equal(early.body.error.code, 'UPLOAD_NOT_FOUND');
      storage.put(key, 2048, 'image/webp');
      const first = await call('POST', `/admin/products/${productId}/media`, { objectKey: key, altText: 'Front view', angle: 'front' });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.isCover, true, 'the first image is the cover');

      const foreign = await call('POST', `/admin/products/${productId}/media`, { objectKey: 'products/other/evil.png' });
      assert.equal(foreign.status, 422, 'keys outside the product prefix are refused');

      const key2 = (await call('POST', '/admin/media/upload-intents', { productId, contentType: 'image/jpeg', sizeBytes: 100 })).body.objectKey;
      storage.put(key2, 100);
      const second = await call('POST', `/admin/products/${productId}/media`, { objectKey: key2, isCover: true });
      assert.equal(second.body.isCover, true);
      const detail = (await call('GET', `/admin/products/${productId}`)).body;
      assert.deepEqual(detail.media.filter((m: Json) => m.isCover).map((m: Json) => m.id), [second.body.id], 'exactly one cover');

      assert.equal((await call('DELETE', `/admin/products/${productId}/media/${second.body.id}`)).status, 204);
      const after = (await call('GET', `/admin/products/${productId}`)).body;
      assert.equal(after.media.length, 1);
      assert.equal(after.media[0].isCover, true, 'the cover is promoted when removed');
    });

    it('signs S3 uploads deterministically with content type and length bound into the signature', () => {
      const s3 = new S3Storage({ endpoint: 'https://acct.r2.test', bucket: 'jetty', accessKeyId: 'AKID', secretAccessKey: 'SECRET', region: 'auto' });
      const now = new Date('2026-01-02T03:04:05Z');
      const a = s3.presignUpload({ key: 'products/p/x.png', contentType: 'image/png', sizeBytes: 10, expiresInSeconds: 300, now });
      const again = s3.presignUpload({ key: 'products/p/x.png', contentType: 'image/png', sizeBytes: 10, expiresInSeconds: 300, now });
      const other = s3.presignUpload({ key: 'products/p/x.png', contentType: 'image/png', sizeBytes: 11, expiresInSeconds: 300, now });
      assert.equal(a.url, again.url);
      assert.notEqual(new URL(a.url).searchParams.get('X-Amz-Signature'), new URL(other.url).searchParams.get('X-Amz-Signature'));
      const u = new URL(a.url);
      assert.equal(u.pathname, '/jetty/products/p/x.png');
      assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
      assert.equal(u.searchParams.get('X-Amz-Date'), '20260102T030405Z');
      assert.equal(u.searchParams.get('X-Amz-Expires'), '300');
      assert.ok(!a.url.includes('SECRET'));
    });
  });

  describe('categories and collections', () => {
    it('rejects category cycles and bad parents, and lists inactive ones for admins', async () => {
      const a = await call('POST', '/admin/categories', { name: 'Wig Types' });
      const b = await call('POST', '/admin/categories', { name: 'Frontal Lace', parentId: a.body.id });
      assert.equal(b.status, 201);
      assert.equal((await call('PATCH', `/admin/categories/${a.body.id}`, { parentId: b.body.id })).status, 422, 'parent under its own child');
      assert.equal((await call('PATCH', `/admin/categories/${a.body.id}`, { parentId: a.body.id })).status, 422);
      assert.equal((await call('POST', '/admin/categories', { name: 'Ghost', parentId: '00000000-0000-4000-8000-000000000000' })).status, 422);
      assert.equal((await call('POST', '/admin/categories', { name: 'Wig Types' })).status, 409, 'duplicate slug');
      await call('PATCH', `/admin/categories/${b.body.id}`, { active: false });
      assert.ok((await call('GET', '/admin/categories')).body.data.some((c: Json) => c.id === b.body.id && !c.active));
      const tree = ((await api.inject({ url: '/api/v1/categories' })).result as Json).data.categories;
      assert.equal(tree.find((c: Json) => c.slug === 'wig-types').children.length, 0, 'inactive children are hidden from shoppers');
    });

    it('creates collections and orders their products', async () => {
      const p1 = (await call('POST', '/admin/products', { title: 'Col A' })).body.product.id;
      const p2 = (await call('POST', '/admin/products', { title: 'Col B' })).body.product.id;
      const col = await call('POST', '/admin/collections', { name: 'Summer Edit', description: 'Hot picks' });
      assert.equal(col.status, 201);
      assert.equal(col.body.slug, 'summer-edit');
      const set = await call('PUT', `/admin/collections/${col.body.id}/products`, { productIds: [p2, p1] });
      assert.deepEqual(set.body.productIds, [p2, p1]);
      assert.equal((await call('PUT', `/admin/collections/${col.body.id}/products`, { productIds: ['00000000-0000-4000-8000-000000000000'] })).status, 422);
      assert.equal((await call('PATCH', `/admin/collections/${col.body.id}`, { description: '' })).body.description, null);

      const members = await call('GET', `/admin/collections/${col.body.id}/products`);
      assert.deepEqual(members.body.data.map((m: Json) => [m.id, m.title, m.status]), [[p2, 'Col B', 'draft'], [p1, 'Col A', 'draft']], 'in display order, drafts included');
      assert.equal((await call('GET', '/admin/collections/00000000-0000-4000-8000-000000000000/products')).status, 404);
      const listed = (await call('GET', '/admin/collections')).body.data.find((c: Json) => c.id === col.body.id);
      assert.equal(listed.productCount, 2, 'the list says how many products each collection holds');
      assert.equal((await call('GET', '/admin/categories')).body.data.every((c: Json) => typeof c.productCount === 'number'), true);
    });
  });

  describe('inventory', () => {
    let variantId = '';
    before(async () => {
      const p = (await call('POST', '/admin/products', { title: 'Stock Wig' })).body.product.id;
      const res = await call('PUT', `/admin/products/${p}/variants`, { options: [], variants: [{ sku: 'STOCK-1', priceMinor: 1000, stock: 10 }] });
      variantId = res.body.variants[0].id;
    });

    it('adjusts and recounts via the ledger and protects reserved stock', async () => {
      const up = await call('PATCH', `/admin/inventory/${variantId}`, { mode: 'adjust', quantity: 5, reason: 'restock', reference: 'PO-1', lowStockThreshold: 4 });
      assert.deepEqual([up.body.onHand, up.body.available, up.body.lowStockThreshold], [15, 15, 4]);
      const down = await call('PATCH', `/admin/inventory/${variantId}`, { mode: 'adjust', quantity: -3, reason: 'damaged' });
      assert.equal(down.body.onHand, 12);
      const count = await call('PATCH', `/admin/inventory/${variantId}`, { mode: 'set', quantity: 9, reason: 'stock_count' });
      assert.equal(count.body.onHand, 9);
      const moves = await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variantId));
      assert.deepEqual(moves.map((m) => [m.reason, m.quantityDelta]).sort(), [['damaged', -3], ['initial_stock', 10], ['restock', 5], ['stock_count', -3]].sort());
      assert.ok(moves.every((m) => m.reason === 'initial_stock' || m.adminUserId === owner.id));

      // Reserve 6 for an open order: on-hand may not drop below that.
      const [o] = await t.db.insert(orders).values({ orderNumber: 'JH-INV-1', phoneE164: '+2348000000001', subtotalMinor: 1, totalMinor: 1, deliveryAddressSnapshot: {}, deliveryMethod: 'next_day', termsAcceptedAt: new Date() }).returning();
      await t.db.insert(stockReservations).values({ orderId: o!.id, variantId, quantity: 6, expiresAt: new Date(Date.now() + 3_600_000) });
      await t.db.update(inventory).set({ reservedQuantity: 6 }).where(eq(inventory.variantId, variantId));
      const blocked = await call('PATCH', `/admin/inventory/${variantId}`, { mode: 'set', quantity: 5, reason: 'correction' });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.error.code, 'STOCK_BELOW_RESERVED');
      assert.equal((await call('PATCH', `/admin/inventory/${variantId}`, { mode: 'set', quantity: 6, reason: 'correction' })).status, 200);
      assert.equal((await call('PATCH', `/admin/inventory/${variantId}`, { mode: 'set', quantity: -1, reason: 'correction' })).status, 422);
      assert.equal((await call('PATCH', `/admin/inventory/00000000-0000-4000-8000-000000000000`, { mode: 'adjust', quantity: 1, reason: 'restock' })).status, 404);
    });

    it('lists stock with low and out filters; support cannot adjust but fulfilment cannot either', async () => {
      const low = await call('GET', '/admin/inventory?filter=low');
      assert.ok(low.body.data.some((r: Json) => r.variantId === variantId && r.available === 0), 'available 0 <= threshold 4');
      assert.ok((await call('GET', '/admin/inventory?filter=out')).body.data.some((r: Json) => r.variantId === variantId));
      assert.equal((await call('GET', '/admin/inventory?q=stock-1')).body.data.length, 1);
      assert.equal((await call('PATCH', `/admin/inventory/${variantId}`, { mode: 'adjust', quantity: 1, reason: 'restock' }, support)).status, 403);
    });
  });
});
