import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { categories, collections, productCategories, productCollections, products } from '../../db/schema/index.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { slugify } from './products.js';
import { uniqueViolation } from '../../lib/sql.js';

type CategoryInput = { name: string; slug?: string | undefined; parentId?: string | null | undefined; sortOrder?: number | undefined; active?: boolean | undefined };

/** Categories with how many products are in each, for the management screen. */
export const listCategories = (db: Db) =>
  db
    .select({ id: categories.id, name: categories.name, slug: categories.slug, parentId: categories.parentId, sortOrder: categories.sortOrder, active: categories.active, productCount: sql<number>`(select count(*)::int from ${productCategories} pc where pc.category_id = ${categories.id})` })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name));

export async function createCategory(db: Db, input: CategoryInput) {
  if (input.parentId) await assertParent(db, null, input.parentId);
  try {
    const [row] = await db
      .insert(categories)
      .values({ name: input.name, slug: input.slug ?? slugify(input.name), parentId: input.parentId ?? null, sortOrder: input.sortOrder ?? 0, active: input.active ?? true })
      .returning();
    return row!;
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('SLUG_TAKEN', 'Another category already uses this slug.');
    throw err;
  }
}

/** A category cannot be its own ancestor: walk up from the proposed parent. */
async function assertParent(db: Db, id: string | null, parentId: string) {
  const all = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
  const byId = new Map(all.map((c) => [c.id, c.parentId]));
  if (!byId.has(parentId)) throw unprocessable('VALIDATION_FAILED', 'The parent category does not exist.', [{ path: 'parentId', code: 'any.invalid' }]);
  for (let cursor: string | null | undefined = parentId, hops = 0; cursor && hops < 100; cursor = byId.get(cursor), hops++) {
    if (cursor === id) throw unprocessable('VALIDATION_FAILED', 'A category cannot be placed under itself or its own sub-category.', [{ path: 'parentId', code: 'any.invalid' }]);
  }
}

export async function updateCategory(db: Db, id: string, patch: Partial<CategoryInput>) {
  const [before] = await db.select().from(categories).where(eq(categories.id, id));
  if (!before) throw notFound('Category not found.');
  if (patch.parentId) await assertParent(db, id, patch.parentId);
  try {
    const [after] = await db
      .update(categories)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      })
      .where(eq(categories.id, id))
      .returning();
    return { before, after: after! };
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('SLUG_TAKEN', 'Another category already uses this slug.');
    throw err;
  }
}

type CollectionInput = { name: string; slug?: string | undefined; description?: string | null | undefined; sortOrder?: number | undefined; active?: boolean | undefined };

export const listCollections = (db: Db) =>
  db
    .select({ id: collections.id, name: collections.name, slug: collections.slug, description: collections.description, sortOrder: collections.sortOrder, active: collections.active, productCount: sql<number>`(select count(*)::int from ${productCollections} pc where pc.collection_id = ${collections.id})` })
    .from(collections)
    .orderBy(asc(collections.sortOrder), asc(collections.name));

/** The products in a collection, in display order (any status, so the owner sees drafts that are waiting). */
export async function listCollectionProducts(db: Db, id: string) {
  const [col] = await db.select({ id: collections.id }).from(collections).where(eq(collections.id, id));
  if (!col) throw notFound('Collection not found.');
  return db
    .select({ id: products.id, title: products.title, status: products.status })
    .from(productCollections)
    .innerJoin(products, eq(products.id, productCollections.productId))
    .where(eq(productCollections.collectionId, id))
    .orderBy(asc(productCollections.sortOrder), asc(products.title));
}

export async function createCollection(db: Db, input: CollectionInput) {
  try {
    const [row] = await db
      .insert(collections)
      .values({ name: input.name, slug: input.slug ?? slugify(input.name), description: input.description ?? null, sortOrder: input.sortOrder ?? 0, active: input.active ?? true })
      .returning();
    return row!;
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('SLUG_TAKEN', 'Another collection already uses this slug.');
    throw err;
  }
}

export async function updateCollection(db: Db, id: string, patch: Partial<CollectionInput>) {
  const [before] = await db.select().from(collections).where(eq(collections.id, id));
  if (!before) throw notFound('Collection not found.');
  try {
    const [after] = await db
      .update(collections)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
      })
      .where(eq(collections.id, id))
      .returning();
    return { before, after: after! };
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('SLUG_TAKEN', 'Another collection already uses this slug.');
    throw err;
  }
}

/** Replaces a collection's membership; array order becomes display order. */
export async function setCollectionProducts(db: Db, id: string, productIds: string[]) {
  const unique = [...new Set(productIds)];
  return db.transaction(async (tx) => {
    const [col] = await tx.select({ id: collections.id }).from(collections).where(eq(collections.id, id)).for('update');
    if (!col) throw notFound('Collection not found.');
    if (unique.length) {
      const found = await tx.select({ id: products.id }).from(products).where(inArray(products.id, unique));
      if (found.length !== unique.length) throw unprocessable('VALIDATION_FAILED', 'One or more products do not exist.', [{ path: 'productIds', code: 'any.invalid' }]);
    }
    await tx.delete(productCollections).where(eq(productCollections.collectionId, id));
    if (unique.length) await tx.insert(productCollections).values(unique.map((productId, sortOrder) => ({ productId, collectionId: id, sortOrder })));
    return { productIds: unique };
  });
}
