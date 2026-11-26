import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { inventory, productMedia, productOptionValues, productOptions, productVariants, products, variantOptionValues } from '../../db/schema/index.js';

export type LineImage = { objectKey: string; altText: string | null; width: number | null; height: number | null };

/** The options and cover photo a bag line shows, for these variants. */
export async function displayData(db: Db, rows: { variantId: string; productId: string }[]) {
  const ids = rows.map((r) => r.variantId);
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const [optionRows, imageRows] = await Promise.all([
    db
      .select({ variantId: variantOptionValues.variantId, name: productOptions.name, label: productOptionValues.label, order: productOptions.sortOrder })
      .from(variantOptionValues)
      .innerJoin(productOptionValues, eq(productOptionValues.id, variantOptionValues.optionValueId))
      .innerJoin(productOptions, eq(productOptions.id, productOptionValues.optionId))
      .where(inArray(variantOptionValues.variantId, ids))
      .orderBy(asc(productOptions.sortOrder)),
    db
      .select({ productId: productMedia.productId, objectKey: productMedia.objectKey, altText: productMedia.altText, width: productMedia.width, height: productMedia.height })
      .from(productMedia)
      .where(inArray(productMedia.productId, productIds))
      .orderBy(desc(productMedia.isCover), asc(productMedia.sortOrder), asc(productMedia.createdAt)),
  ]);
  const optionsByVariant = new Map<string, { name: string; label: string }[]>();
  for (const o of optionRows) optionsByVariant.set(o.variantId, [...(optionsByVariant.get(o.variantId) ?? []), { name: o.name, label: o.label }]);
  const imageByProduct = new Map<string, LineImage>();
  for (const m of imageRows) if (!imageByProduct.has(m.productId)) imageByProduct.set(m.productId, { objectKey: m.objectKey, altText: m.altText, width: m.width, height: m.height });
  return { optionsByVariant, imageByProduct };
}

/** The variant rows (price, stock, product) for live, published products, in the shape the pricing code reads. */
export const liveVariants = (db: Db, ids: string[]) =>
  db
    .select({
      variantId: productVariants.id,
      productId: productVariants.productId,
      title: products.title,
      slug: products.slug,
      compareAt: productVariants.compareAtPriceMinor,
      priceMinor: productVariants.priceMinor,
      currency: productVariants.currency,
      onHand: inventory.onHandQuantity,
      reserved: inventory.reservedQuantity,
    })
    .from(productVariants)
    .innerJoin(products, and(eq(products.id, productVariants.productId), eq(products.status, 'active'), or(isNull(products.publishedAt), lte(products.publishedAt, sql`now()`))))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(and(inArray(productVariants.id, ids), eq(productVariants.active, true)));

/** Units that can be bought right now: on hand minus reserved, never negative. */
export const availableOf = (row: { onHand: number | null; reserved: number | null }) => Math.max((row.onHand ?? 0) - (row.reserved ?? 0), 0);
