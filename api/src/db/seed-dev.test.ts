import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import Joi from 'joi';
import { getHome } from '../modules/content/content.js';
import { getFacets, listProducts } from '../modules/catalog/listing.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../testing/database.js';
import { DEV_OWNER, PRODUCT_SEEDS, seedDev } from './seed-dev.js';
import { customers, deliveryZones, inventory, orders, productMedia, products, promotions, reviews } from './schema/index.js';

const count = async (t: TestDatabase, table: PgTable) => Number((await t.db.select({ n: sql<number>`count(*)` }).from(table))[0]!.n);

describe('development seed data', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let mediaDir: string;
  before(async () => {
    t = await createTestDatabase();
    mediaDir = await mkdtemp(join(tmpdir(), 'jetty-mock-media-'));
    await seedDev(t.db, { mediaDir });
  });
  after(async () => {
    await t?.destroy();
    if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
  });

  it('uses an owner email the API accepts at login', () => {
    assert.equal(Joi.string().email().validate(DEV_OWNER.email).error, undefined);
  });

  it('is idempotent: a second run adds nothing', async () => {
    const before = [await count(t, products), await count(t, orders), await count(t, promotions), await count(t, customers), await count(t, reviews)];
    await seedDev(t.db, { mediaDir });
    assert.deepEqual([await count(t, products), await count(t, orders), await count(t, promotions), await count(t, customers), await count(t, reviews)], before);
  });

  it('publishes every product except the draft, and has filters to offer', async () => {
    const live = await listProducts(t.db, { filters: { options: {} }, sort: 'recommended', limit: 100, withTotal: true });
    assert.equal(live.page?.total ?? live.data.length, PRODUCT_SEEDS.filter((p) => p.status !== 'draft').length);
    assert.ok(!live.data.some((p) => p.slug === 'draft-ombre-wig'));
    const facets = await getFacets(t.db, { options: {} });
    for (const name of ['texture', 'lace', 'length', 'density', 'colour'] as const) assert.ok(facets.options[name].length > 0, `${name} has values`);
    assert.ok(facets.price && facets.price.maxMinor > facets.price.minMinor);
    assert.ok(facets.onOfferCount > 0);
  });

  it('includes the edge cases: sold out, low stock', async () => {
    const stock = async (slug: string) => (await t.db.execute<{ n: number }>(sql`select i.on_hand_quantity as n from inventory i join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id where p.slug = ${slug}`)).map((r) => Number(r.n));
    assert.ok((await stock('sold-out-curly-wig')).every((n) => n === 0));
    assert.ok((await stock('low-stock-pixie-wig')).every((n) => n <= 2));
    assert.ok((await t.db.select().from(inventory)).length > 50);
  });

  it('fills every home block and has live delivery zones', async () => {
    const home = await getHome(t.db);
    assert.deepEqual(home.sections.map((s) => s.type), ['stories', 'hero', 'flash', 'products', 'length', 'tiles', 'trust']);
    assert.equal(home.announcements.length, 1);
    assert.ok((await t.db.select().from(deliveryZones).where(eq(deliveryZones.active, true))).length >= 3);
  });

  it('gives every product three images with the cover first, each written as a file', async () => {
    const media = await t.db.select().from(productMedia);
    assert.equal(media.length, PRODUCT_SEEDS.length * 3);
    assert.equal(media.filter((m) => m.isCover).length, PRODUCT_SEEDS.length);
    assert.deepEqual([...new Set(media.map((m) => m.angle))].sort(), ['detail', 'front', 'side']);
    for (const m of media) assert.ok(existsSync(join(mediaDir, m.objectKey)), `${m.objectKey} was written`);
    assert.ok(existsSync(join(mediaDir, 'content/dev-hero-frontals.svg')));
  });
});
