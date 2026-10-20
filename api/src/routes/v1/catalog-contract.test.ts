import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { adminAuditLog, inventory, productVariants } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createServer } from '../../server.js';
import { adminTestEnv, signInAdmin } from '../../testing/admin.js';
import { makeProduct, paidOrder } from '../../testing/catalog-fixtures.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { FakeStorage } from '../../testing/fake-storage.js';

type Json = Record<string, any>;
const colours = { name: 'Colour', values: [{ key: 'black', label: 'Jet black', swatch: '#1a1a1a' }, { key: 'brown', label: 'Chestnut', swatch: '#6b3f26' }] };
const lengths = (...keys: string[]) => ({ name: 'Length', values: keys.map((k) => ({ key: k, label: `${k}"` })) });

describe('catalog contract for the storefront', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  const ids: Record<string, { id: string; variantIds: Record<string, string> }> = {};
  const get = async (url: string) => {
    const res = await api.inject(`/api/v1${url}`);
    return { status: res.statusCode, body: res.result as Json };
  };

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, storage: new FakeStorage() });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');

    ids.alpha = await makeProduct(t, 'alpha-wig', {
      title: 'Alpha Wig', featured: true, badge: 'Best seller', cover: true,
      published: new Date(Date.now() - 2 * 86_400_000),
      options: [lengths('14', '20'), colours],
      variants: [
        { sku: 'A-14-B', pick: { Length: '14', Colour: 'black' }, price: 100000, compareAt: 125000, stock: 2 },
        { sku: 'A-20-B', pick: { Length: '20', Colour: 'black' }, price: 150000, stock: 8 },
        { sku: 'A-20-N', pick: { Length: '20', Colour: 'brown' }, price: 150000, stock: 0 },
      ],
    });
    ids.beta = await makeProduct(t, 'beta-closure', {
      title: 'Beta Closure', cover: true, options: [lengths('10', '12')],
      variants: [{ sku: 'B-10', pick: { Length: '10' }, price: 50000, stock: 5 }, { sku: 'B-12', pick: { Length: '12' }, price: 60000, stock: 5 }],
    });
    ids.gamma = await makeProduct(t, 'gamma-oil', { title: 'Gamma Oil', published: new Date(), variants: [{ sku: 'G-1', pick: {}, price: 8000, stock: 20 }] });
    // Alpha's 14" black sells best, but only 2 are left.
    await paidOrder(t, [{ productId: ids.alpha!.id, variantId: ids.alpha!.variantIds['A-14-B']!, quantity: 3 }, { productId: ids.alpha!.id, variantId: ids.alpha!.variantIds['A-20-B']!, quantity: 1 }]);
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  describe('listing (A3)', () => {
    it('reports the total on the first page only, and is exact for the filters', async () => {
      const first = await get('/products?limit=1');
      assert.equal(first.body.page.total, 3);
      const next = await get(`/products?limit=1&cursor=${first.body.page.nextCursor}`);
      assert.equal(next.body.page.total, null, 'later pages skip the count');
      assert.equal((await get('/products?inStock=true&length=12')).body.page.total, 1);
      assert.equal((await get('/products?onOffer=true')).body.page.total, 1);
      assert.equal((await get('/products?q=nothing-matches-this')).body.page.total, 0);
    });

    it('gives cards colour dots, a length range and computed badges', async () => {
      const cards = (await get('/products?q=alpha')).body.data as Json[];
      const alpha = cards[0]!;
      assert.deepEqual(alpha.colours, [{ label: 'Jet black', valueKey: 'black', swatch: '#1a1a1a' }, { label: 'Chestnut', valueKey: 'brown', swatch: '#6b3f26' }]);
      assert.deepEqual(alpha.lengthRange, { min: 14, max: 20 });
      assert.deepEqual(alpha.badges.map((b: Json) => b.kind), ['custom', 'sale', 'low_stock', 'new', 'featured']);
      assert.equal(alpha.badges[0].label, 'Best seller');
      assert.equal(alpha.badges[1].label, '-20%');
      assert.match(alpha.image.url, /cover\.webp/);

      const oil = ((await get('/products?q=gamma')).body.data as Json[])[0]!;
      assert.deepEqual(oil.colours, []);
      assert.equal(oil.lengthRange, null);
      assert.deepEqual(oil.badges.map((b: Json) => b.kind), ['new']);
    });

    it('returns facets that ignore each option’s own selection, plus the price range and toggle counts', async () => {
      const all = (await get('/products/facets')).body.data;
      assert.deepEqual(all.options.length.map((v: Json) => [v.valueKey, v.count]), [['10', 1], ['12', 1], ['14', 1], ['20', 1]], 'numeric values sort as numbers');
      assert.deepEqual(all.options.colour.map((v: Json) => [v.valueKey, v.swatch, v.count]), [['black', '#1a1a1a', 1], ['brown', '#6b3f26', 1]]);
      assert.deepEqual(all.options.texture, []);
      assert.deepEqual(all.price, { minMinor: 8000, maxMinor: 150000 });
      assert.deepEqual([all.inStockCount, all.onOfferCount], [3, 1]);

      // Choosing a colour narrows lengths, but the colour facet still offers the other colour.
      const black = (await get('/products/facets?colour=black')).body.data;
      assert.deepEqual(black.options.length.map((v: Json) => v.valueKey).sort(), ['14', '20']);
      assert.deepEqual(black.options.colour.map((v: Json) => v.valueKey), ['black', 'brown']);
      assert.deepEqual([black.inStockCount, black.onOfferCount], [1, 1]);
      // Price filter does not shrink the price range it is chosen from.
      assert.deepEqual((await get('/products/facets?minPrice=100000')).body.data.price, { minMinor: 8000, maxMinor: 150000 });
      // Scoped to a collection or search.
      assert.deepEqual((await get('/products/facets?q=closure')).body.data.options.length.map((v: Json) => v.valueKey), ['10', '12']);
    });

    it('validates facet parameters like the listing does', async () => {
      assert.equal((await get('/products/facets?minPrice=-1')).status, 422);
      assert.equal((await get('/products/facets?sort=newest')).status, 422, 'sorting and paging make no sense here');
      assert.equal((await get('/products/facets?collection=Not A Slug')).status, 422);
    });
  });

  describe('product detail (A4)', () => {
    it('exposes swatches, a sold count and the best-selling buyable variant as the default', async () => {
      const { data } = (await get('/products/alpha-wig')).body;
      assert.deepEqual(data.options.find((o: Json) => o.name === 'Colour').values.map((v: Json) => v.swatch), ['#1a1a1a', '#6b3f26']);
      assert.equal(data.options.find((o: Json) => o.name === 'Length').values[0].swatch, null);
      assert.equal(data.soldCount, 4);
      assert.equal(data.defaultVariantId, ids.alpha!.variantIds['A-14-B']);

      // When the best seller sells out, the next best that can be bought takes over.
      await t.db.update(inventory).set({ onHandQuantity: 0 }).where(eq(inventory.variantId, ids.alpha!.variantIds['A-14-B']!));
      assert.equal((await get('/products/alpha-wig')).body.data.defaultVariantId, ids.alpha!.variantIds['A-20-B']);
      await t.db.update(inventory).set({ onHandQuantity: 2 }).where(eq(inventory.variantId, ids.alpha!.variantIds['A-14-B']!));
    });

    it('with nothing sold yet, defaults to the cheapest buyable variant', async () => {
      assert.equal((await get('/products/beta-closure')).body.data.defaultVariantId, ids.beta!.variantIds['B-10']);
      assert.equal((await get('/products/beta-closure')).body.data.soldCount, 0);
    });

    it('always returns the four info sections, and staff can only write those', async () => {
      const bare = (await get('/products/gamma-oil')).body.data.details;
      assert.deepEqual(bare, { details: null, fit: null, care: null, delivery: null });

      const etag = (await api.inject({ url: `/api/v1/admin/products/${ids.gamma!.id}`, headers: owner.headers })).headers.etag as string;
      const send = (details: Json, tag = etag) => api.inject({ method: 'PATCH', url: `/api/v1/admin/products/${ids.gamma!.id}`, payload: { details }, headers: { ...owner.headers, 'if-match': tag } });
      const ok = await send({ care: '## Wash gently\nCold water.', delivery: '' });
      assert.equal(ok.statusCode, 200, JSON.stringify(ok.result));
      const shown = (await get('/products/gamma-oil')).body.data.details;
      assert.deepEqual(shown, { details: null, fit: null, care: '## Wash gently\nCold water.', delivery: null });
      assert.equal((await send({ warranty: 'lifetime' }, ok.headers.etag as string)).statusCode, 422, 'unknown sections are refused');
    });

    it('saves swatches through the matrix and rejects malformed ones', async () => {
      const created = await api.inject({ method: 'POST', url: '/api/v1/admin/products', payload: { title: 'Swatch Wig' }, headers: owner.headers });
      const id = (created.result as Json).product.id as string;
      const put = (swatch: string | null) =>
        api.inject({ method: 'PUT', url: `/api/v1/admin/products/${id}/variants`, payload: { options: [{ name: 'Colour', values: [{ label: 'Red', valueKey: 'red', swatch }] }], variants: [{ sku: 'SW-1', optionValues: { Colour: 'red' }, priceMinor: 1000 }] }, headers: { ...owner.headers, 'if-match': created.headers.etag as string } });
      assert.equal((await put('red')).statusCode, 422);
      assert.equal((await put('#ff00')).statusCode, 422);
      const ok = await put('#C0175B');
      assert.equal(ok.statusCode, 200, JSON.stringify(ok.result));
      assert.equal((ok.result as Json).options[0].values[0].swatch, '#C0175B');
    });
  });

  describe('large variant matrices (A7)', () => {
    // A single option holds at most 50 values, so large matrices come from several options.
    const grid = (a: number, b: number, c: number) => {
      const values = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `v${i}`, valueKey: `v${i}` }));
      const variants: Json[] = [];
      for (let x = 0; x < a; x++) for (let y = 0; y < b; y++) for (let z = 0; z < c; z++) variants.push({ sku: `G-${x}-${y}-${z}`, optionValues: { Length: `v${x}`, Lace: `v${y}`, Density: `v${z}` }, priceMinor: 100000 + x * 1000 + y * 100 + z, stock: 1 });
      return { options: [{ name: 'Length', values: values(a) }, { name: 'Lace', values: values(b) }, { name: 'Density', values: values(c) }], variants };
    };

    it('saves a 1,200-variant product in one request, quickly, and reads it back', async () => {
      const created = await api.inject({ method: 'POST', url: '/api/v1/admin/products', payload: { title: 'Big Matrix' }, headers: owner.headers });
      const id = (created.result as Json).product.id as string;
      const started = Date.now();
      const res = await api.inject({ method: 'PUT', url: `/api/v1/admin/products/${id}/variants`, payload: grid(20, 10, 6), headers: { ...owner.headers, 'if-match': created.headers.etag as string } });
      const seconds = (Date.now() - started) / 1000;
      assert.equal(res.statusCode, 200, JSON.stringify(res.result).slice(0, 300));
      assert.ok(seconds < 8, `took ${seconds}s`);
      const body = res.result as Json;
      assert.equal(body.variants.length, 1200);
      assert.equal(body.variants.filter((v: Json) => v.stock.onHand === 1).length, 1200);
      const links = await t.db.execute(`select count(*)::int as n from variant_option_values vov join product_variants v on v.id = vov.variant_id where v.product_id = '${id}'` as never);
      assert.equal((links as unknown as { n: number }[])[0]!.n, 3600);

      // Re-saving with new prices updates in place; dropping some deactivates, never deletes.
      const next = grid(20, 10, 6);
      next.variants = next.variants.slice(0, 1000).map((v) => ({ ...v, priceMinor: v.priceMinor + 5 }));
      const again = await api.inject({ method: 'PUT', url: `/api/v1/admin/products/${id}/variants`, payload: next, headers: { ...owner.headers, 'if-match': (await api.inject({ url: `/api/v1/admin/products/${id}`, headers: owner.headers })).headers.etag as string } });
      assert.equal(again.statusCode, 200, JSON.stringify(again.result).slice(0, 300));
      const rows = await t.db.select().from(productVariants).where(eq(productVariants.productId, id));
      assert.equal(rows.length, 1200, 'nothing was deleted');
      assert.equal(rows.filter((r) => r.active).length, 1000);

      const latest = (await t.db.select().from(adminAuditLog).where(eq(adminAuditLog.resourceId, id))).filter((a) => a.action === 'product.variants.replace').pop()!;
      assert.ok(((latest.afterJson as Json).sample as unknown[]).length <= 50, 'the audit record stays small');
    });

    it('refuses more than 2,000 variants', async () => {
      const created = await api.inject({ method: 'POST', url: '/api/v1/admin/products', payload: { title: 'Too Big' }, headers: owner.headers });
      const id = (created.result as Json).product.id as string;
      const res = await api.inject({ method: 'PUT', url: `/api/v1/admin/products/${id}/variants`, payload: grid(21, 10, 10), headers: { ...owner.headers, 'if-match': created.headers.etag as string } });
      assert.equal(res.statusCode, 422);
    });
  });
});
