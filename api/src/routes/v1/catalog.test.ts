import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { loadEnv } from '../../config/env.js';
import {
  categories,
  collections,
  inventory,
  productCategories,
  productCollections,
  productMedia,
  productOptionValues,
  productOptions,
  productVariants,
  products,
  variantOptionValues,
} from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createServer } from '../../server.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';

type Card = { slug: string; inStock: boolean; onOffer: boolean; price: { minAmountMinor: number; maxAmountMinor: number } };
type Page = { data: Card[]; page: { nextCursor: string | null } };

describe('catalog routes', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let server: Server;
  const ids: Record<string, string> = {};

  const get = async (url: string) => {
    const res = await server.inject(url);
    return { status: res.statusCode, body: res.result as never as Record<string, any> };
  };
  const slugs = (page: Page) => page.data.map((c) => c.slug);

  async function addProduct(
    slug: string,
    opts: {
      price: number;
      compareAt?: number;
      stock?: number;
      published?: Date;
      status?: 'active' | 'draft';
      featured?: boolean;
      title?: string;
      options?: [string, string][];
    },
  ) {
    const [p] = await t.db
      .insert(products)
      .values({
        slug,
        title: opts.title ?? slug,
        status: opts.status ?? 'active',
        featured: opts.featured ?? false,
        publishedAt: opts.published ?? new Date('2026-01-01T00:00:00Z'),
      })
      .returning();
    const [v] = await t.db
      .insert(productVariants)
      .values({
        productId: p!.id,
        sku: `SKU-${slug}`,
        optionSignature: Object.fromEntries(opts.options ?? []),
        priceMinor: opts.price,
        compareAtPriceMinor: opts.compareAt ?? null,
      })
      .returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: opts.stock ?? 5 });
    for (const [name, key] of opts.options ?? []) {
      const [o] = await t.db
        .insert(productOptions)
        .values({ productId: p!.id, name })
        .returning();
      const [val] = await t.db
        .insert(productOptionValues)
        .values({ optionId: o!.id, label: key, valueKey: key })
        .returning();
      await t.db.insert(variantOptionValues).values({ variantId: v!.id, optionValueId: val!.id });
    }
    ids[slug] = p!.id;
    return p!.id;
  }

  before(async () => {
    t = await createTestDatabase();
    server = await createServer({
      env: loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error' }),
      logger: createLogger('error'),
      database: t,
    });
    await server.initialize();

    const same = new Date('2026-03-01T00:00:00Z'); // identical timestamps exercise the id tiebreak
    for (let i = 1; i <= 7; i++) await addProduct(`tie-${i}`, { price: 1000, published: same });
    await addProduct('frontal-26', { price: 50000, compareAt: 60000, options: [['length', '26'], ['lace', 'hd']] });
    await addProduct('closure-14', { price: 20000, stock: 0, options: [['length', '14']] });
    await addProduct('featured-wig', { price: 90000, featured: true, title: 'Silky Straight Bob', published: new Date('2026-06-01T00:00:00Z') });
    await addProduct('draft-wig', { price: 100, status: 'draft' });
    await addProduct('future-wig', { price: 100, published: new Date(Date.now() + 86_400_000) });
    await t.db.insert(productVariants).values({ productId: ids['closure-14']!, sku: 'SKU-inactive', optionSignature: { x: 1 }, priceMinor: 1, active: false });

    const [parent] = await t.db.insert(categories).values({ slug: 'wigs', name: 'Wigs' }).returning();
    const [child] = await t.db.insert(categories).values({ slug: 'frontal', name: 'Frontal', parentId: parent!.id }).returning();
    await t.db.insert(categories).values({ slug: 'hidden', name: 'Hidden', active: false });
    await t.db.insert(productCategories).values({ productId: ids['frontal-26']!, categoryId: child!.id });

    const [col] = await t.db.insert(collections).values({ slug: 'best', name: 'Best' }).returning();
    await t.db.insert(collections).values({ slug: 'off', name: 'Off', active: false });
    await t.db.insert(productCollections).values([
      { productId: ids['frontal-26']!, collectionId: col!.id },
      { productId: ids['closure-14']!, collectionId: col!.id },
    ]);
    await t.db.insert(productMedia).values([
      { productId: ids['frontal-26']!, objectKey: 'a.jpg', sortOrder: 2 },
      { productId: ids['frontal-26']!, objectKey: 'cover.jpg', sortOrder: 5, isCover: true },
    ]);
  });

  after(async () => {
    await server?.stop();
    await t?.destroy();
  });

  it('hides draft, future-dated and variant-less products', async () => {
    const { body } = await get('/api/v1/products?limit=100');
    const all = slugs(body as Page);
    assert.ok(!all.includes('draft-wig') && !all.includes('future-wig'));
    assert.equal(all.length, 10);
  });

  it('paginates every sort without duplicates or gaps, including ties', async () => {
    for (const sort of ['recommended', 'newest', 'bestSelling', 'topRated', 'priceAsc', 'priceDesc']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const { status, body } = await get(`/api/v1/products?limit=3&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`);
        assert.equal(status, 200, sort);
        seen.push(...slugs(body as Page));
        cursor = (body as Page).page.nextCursor;
      } while (cursor);
      assert.equal(seen.length, 10, sort);
      assert.equal(new Set(seen).size, 10, sort);
    }
  });

  it('orders by price and surfaces featured products first when recommended', async () => {
    const asc = (await get('/api/v1/products?sort=priceAsc&limit=100')).body as Page;
    const prices = asc.data.map((c) => c.price.minAmountMinor);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
    const rec = (await get('/api/v1/products?limit=1')).body as Page;
    assert.equal(rec.data[0]!.slug, 'featured-wig');
  });

  it('applies variant filters to one and the same variant', async () => {
    assert.deepEqual(slugs((await get('/api/v1/products?length=26&lace=hd')).body as Page), ['frontal-26']);
    assert.deepEqual(slugs((await get('/api/v1/products?length=14&inStock=true')).body as Page), []);
    assert.deepEqual(slugs((await get('/api/v1/products?length=14,26&limit=100')).body as Page).sort(), ['closure-14', 'frontal-26']);
    assert.deepEqual(slugs((await get('/api/v1/products?onOffer=true')).body as Page), ['frontal-26']);
    assert.deepEqual(slugs((await get('/api/v1/products?minPrice=40000&maxPrice=60000')).body as Page), ['frontal-26']);
  });

  it('reports availability and ignores inactive variants in price ranges', async () => {
    const { body } = await get('/api/v1/products?length=14');
    const card = (body as Page).data[0]!;
    assert.equal(card.inStock, false);
    assert.equal(card.price.minAmountMinor, 20000);
  });

  it('searches titles and escapes LIKE wildcards', async () => {
    assert.deepEqual(slugs((await get('/api/v1/products?q=silky')).body as Page), ['featured-wig']);
    assert.deepEqual(slugs((await get('/api/v1/products?q=ilk')).body as Page), ['featured-wig']);
    assert.deepEqual(slugs((await get('/api/v1/products?q=%25')).body as Page), []);
  });

  it('filters by category including descendants', async () => {
    assert.deepEqual(slugs((await get('/api/v1/products?category=wigs')).body as Page), ['frontal-26']);
    assert.deepEqual(slugs((await get('/api/v1/products?category=hidden')).body as Page), []);
  });

  it('lists collection products and 404s inactive or unknown collections', async () => {
    const { body } = await get('/api/v1/collections/best/products?limit=100');
    assert.deepEqual(slugs(body as Page).sort(), ['closure-14', 'frontal-26']);
    assert.equal((await get('/api/v1/collections/off/products')).status, 404);
    assert.equal((await get('/api/v1/collections/nope/products')).status, 404);
  });

  it('returns the cover image and the category tree', async () => {
    const card = ((await get('/api/v1/products?q=frontal')).body as Page).data[0] as unknown as { image: { objectKey: string } };
    assert.equal(card.image.objectKey, 'cover.jpg');
    const { body } = await get('/api/v1/categories');
    const tree = body.data.categories;
    assert.equal(tree.length, 1);
    assert.equal(tree[0].slug, 'wigs');
    assert.equal(tree[0].children[0].slug, 'frontal');
    assert.deepEqual(body.data.collections.map((c: { slug: string }) => c.slug), ['best']);
  });

  it('returns product detail with variants, options and availability', async () => {
    const { status, body } = await get('/api/v1/products/frontal-26');
    assert.equal(status, 200);
    const p = body.data;
    assert.equal(p.options.length, 2);
    assert.equal(p.variants.length, 1);
    assert.equal(p.variants[0].price.amountMinor, 50000);
    assert.equal(p.variants[0].compareAtPrice.amountMinor, 60000);
    assert.equal(p.variants[0].optionValueIds.length, 2);
    assert.deepEqual(p.variants[0].availability, { inStock: true, availableQuantity: 5, lowStock: false });
    assert.equal(p.media.length, 2);
    assert.equal(p.categories[0].slug, 'frontal');

    const closure = (await get('/api/v1/products/closure-14')).body.data;
    assert.equal(closure.variants.length, 1, 'inactive variant is not exposed');
    assert.equal(closure.variants[0].availability.inStock, false);
  });

  it('404s unpublished products on the detail route', async () => {
    assert.equal((await get('/api/v1/products/draft-wig')).status, 404);
    assert.equal((await get('/api/v1/products/future-wig')).status, 404);
    assert.equal((await get('/api/v1/products/missing')).status, 404);
  });

  it('rejects bad input with the documented envelope', async () => {
    assert.equal((await get('/api/v1/products?limit=101')).status, 422);
    assert.equal((await get('/api/v1/products?sort=cheapest')).status, 422);
    assert.equal((await get('/api/v1/products?minPrice=9&maxPrice=1')).status, 422);
    assert.equal((await get('/api/v1/products?unknown=1')).status, 422);
    const bad = await get('/api/v1/products?cursor=garbage');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'BAD_REQUEST');
    const first = (await get('/api/v1/products?limit=1&sort=newest')).body as Page;
    const mismatched = await get(`/api/v1/products?sort=priceAsc&cursor=${first.page.nextCursor}`);
    assert.equal(mismatched.status, 400);
  });

  it('is not vulnerable to SQL injection through filters', async () => {
    const res = await get(`/api/v1/products?q=${encodeURIComponent("'; drop table products; --")}&length=${encodeURIComponent("1') or ('1'='1")}`);
    assert.equal(res.status, 200);
    assert.equal((await get('/api/v1/products?limit=1')).status, 200);
  });
});
