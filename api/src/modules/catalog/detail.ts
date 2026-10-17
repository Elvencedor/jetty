import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
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

export type CategoryNode = { id: string; slug: string; name: string; children: CategoryNode[] };

export async function getCategoryTree(db: Db) {
  const [cats, cols] = await Promise.all([
    db
      .select({ id: categories.id, parentId: categories.parentId, slug: categories.slug, name: categories.name })
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({ id: collections.id, slug: collections.slug, name: collections.name, description: collections.description })
      .from(collections)
      .where(eq(collections.active, true))
      .orderBy(asc(collections.sortOrder), asc(collections.name)),
  ]);

  const nodes = new Map<string, CategoryNode>(cats.map((c) => [c.id, { id: c.id, slug: c.slug, name: c.name, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const c of cats) {
    const node = nodes.get(c.id)!;
    // A child whose parent is inactive is hidden along with that parent.
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    if (parent) parent.children.push(node);
    else if (!c.parentId) roots.push(node);
  }
  return { categories: roots, collections: cols };
}

export async function collectionExists(db: Db, slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.slug, slug), eq(collections.active, true)));
  return Boolean(row);
}

const DEFAULT_LOW_STOCK_THRESHOLD = 3;

export async function getProductBySlug(db: Db, slug: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.slug, slug),
        eq(products.status, 'active'),
        or(isNull(products.publishedAt), lte(products.publishedAt, sql`now()`)),
      ),
    );
  if (!product) return undefined;

  const [options, variants, media, cats, cols, rating] = await Promise.all([
    db
      .select({
        optionId: productOptions.id,
        name: productOptions.name,
        optionOrder: productOptions.sortOrder,
        valueId: productOptionValues.id,
        label: productOptionValues.label,
        valueKey: productOptionValues.valueKey,
        valueOrder: productOptionValues.sortOrder,
      })
      .from(productOptions)
      .innerJoin(productOptionValues, and(eq(productOptionValues.optionId, productOptions.id), eq(productOptionValues.active, true)))
      .where(eq(productOptions.productId, product.id))
      .orderBy(asc(productOptions.sortOrder), asc(productOptionValues.sortOrder)),
    db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        priceMinor: productVariants.priceMinor,
        compareAtPriceMinor: productVariants.compareAtPriceMinor,
        currency: productVariants.currency,
        onHand: inventory.onHandQuantity,
        reserved: inventory.reservedQuantity,
        lowStockThreshold: inventory.lowStockThreshold,
      })
      .from(productVariants)
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(and(eq(productVariants.productId, product.id), eq(productVariants.active, true)))
      .orderBy(asc(productVariants.priceMinor), asc(productVariants.sku)),
    db
      .select({
        id: productMedia.id,
        variantId: productMedia.variantId,
        objectKey: productMedia.objectKey,
        altText: productMedia.altText,
        mediaType: productMedia.mediaType,
        angle: productMedia.angle,
        isCover: productMedia.isCover,
        width: productMedia.width,
        height: productMedia.height,
      })
      .from(productMedia)
      .where(eq(productMedia.productId, product.id))
      .orderBy(asc(productMedia.sortOrder), asc(productMedia.createdAt)),
    db
      .select({ slug: categories.slug, name: categories.name })
      .from(productCategories)
      .innerJoin(categories, and(eq(categories.id, productCategories.categoryId), eq(categories.active, true)))
      .where(eq(productCategories.productId, product.id))
      .orderBy(asc(categories.sortOrder)),
    db
      .select({ slug: collections.slug, name: collections.name })
      .from(productCollections)
      .innerJoin(collections, and(eq(collections.id, productCollections.collectionId), eq(collections.active, true)))
      .where(eq(productCollections.productId, product.id))
      .orderBy(asc(collections.sortOrder)),
    db.execute(sql`
      select round(avg(rating), 2)::float8 as average, count(*)::int as count
      from reviews where product_id = ${product.id} and status = 'approved'`),
  ]);

  const variantIds = variants.map((v) => v.id);
  const links = variantIds.length
    ? await db
        .select({ variantId: variantOptionValues.variantId, optionValueId: variantOptionValues.optionValueId })
        .from(variantOptionValues)
        .where(inArray(variantOptionValues.variantId, variantIds))
    : [];
  const valuesByVariant = new Map<string, string[]>();
  for (const l of links) valuesByVariant.set(l.variantId, [...(valuesByVariant.get(l.variantId) ?? []), l.optionValueId]);

  const optionList: { id: string; name: string; values: { id: string; label: string; valueKey: string }[] }[] = [];
  for (const o of options) {
    let entry = optionList.find((x) => x.id === o.optionId);
    if (!entry) optionList.push((entry = { id: o.optionId, name: o.name, values: [] }));
    entry.values.push({ id: o.valueId, label: o.label, valueKey: o.valueKey });
  }

  const ratingRow = (rating as unknown as { average: number | null; count: number }[])[0];

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    badge: product.badgeOverride,
    featured: product.featured,
    seo: { title: product.seoTitle, description: product.seoDescription },
    details: product.detailsJson,
    publishedAt: product.publishedAt,
    categories: cats,
    collections: cols,
    options: optionList,
    variants: variants.map((v) => {
      const available = Math.max((v.onHand ?? 0) - (v.reserved ?? 0), 0);
      return {
        id: v.id,
        sku: v.sku,
        price: { amountMinor: v.priceMinor, currency: v.currency },
        compareAtPrice: v.compareAtPriceMinor === null ? null : { amountMinor: v.compareAtPriceMinor, currency: v.currency },
        optionValueIds: valuesByVariant.get(v.id) ?? [],
        availability: {
          inStock: available > 0,
          availableQuantity: available,
          lowStock: available > 0 && available <= (v.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD),
        },
      };
    }),
    media,
    rating: { average: ratingRow?.average ?? 0, count: ratingRow?.count ?? 0 },
  };
}
