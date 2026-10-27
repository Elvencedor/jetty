import type { TestDatabase } from './database.js';
import { inventory, orderItems, orders, productMedia, productOptionValues, productOptions, productVariants, products, variantOptionValues } from '../db/schema/index.js';

export type FixtureOption = { name: string; values: { key: string; label?: string; swatch?: string }[] };
export type FixtureVariant = { sku: string; pick: Record<string, string>; price: number; compareAt?: number; stock?: number; lowStockThreshold?: number };

/** Inserts a product with options, variants, stock and an optional cover image, straight into the database. */
export async function makeProduct(
  t: TestDatabase,
  slug: string,
  spec: { title?: string; featured?: boolean; badge?: string; published?: Date; options?: FixtureOption[]; variants: FixtureVariant[]; cover?: boolean },
) {
  const [p] = await t.db
    .insert(products)
    .values({ slug, title: spec.title ?? slug, status: 'active', featured: spec.featured ?? false, badgeOverride: spec.badge ?? null, publishedAt: spec.published ?? new Date('2026-01-01T00:00:00Z') })
    .returning();
  const valueId = new Map<string, string>();
  for (const [oi, option] of (spec.options ?? []).entries()) {
    const [o] = await t.db.insert(productOptions).values({ productId: p!.id, name: option.name, sortOrder: oi }).returning();
    for (const [vi, v] of option.values.entries()) {
      const [row] = await t.db.insert(productOptionValues).values({ optionId: o!.id, label: v.label ?? v.key, valueKey: v.key, swatch: v.swatch ?? null, sortOrder: vi }).returning();
      valueId.set(`${option.name}\u0000${v.key}`, row!.id);
    }
  }
  const variantIds: Record<string, string> = {};
  for (const v of spec.variants) {
    const [row] = await t.db.insert(productVariants).values({ productId: p!.id, sku: v.sku, optionSignature: v.pick, priceMinor: v.price, compareAtPriceMinor: v.compareAt ?? null }).returning();
    variantIds[v.sku] = row!.id;
    await t.db.insert(inventory).values({ variantId: row!.id, onHandQuantity: v.stock ?? 10, lowStockThreshold: v.lowStockThreshold ?? null });
    for (const [name, key] of Object.entries(v.pick)) await t.db.insert(variantOptionValues).values({ variantId: row!.id, optionValueId: valueId.get(`${name}\u0000${key}`)! });
  }
  if (spec.cover) await t.db.insert(productMedia).values({ productId: p!.id, objectKey: `products/${p!.id}/cover.webp`, isCover: true, altText: `${slug} photo` });
  return { id: p!.id, variantIds };
}

let orderSeq = 0;
/** A paid order for the given lines, so sold counts and best sellers have something to count. */
export async function paidOrder(t: TestDatabase, lines: { productId: string; variantId: string; quantity: number }[], over: Partial<typeof orders.$inferInsert> = {}) {
  const total = lines.reduce((s, l) => s + 1000 * l.quantity, 0);
  const [o] = await t.db
    .insert(orders)
    .values({ orderNumber: `JH-FX-${++orderSeq}-${Math.random().toString(36).slice(2, 7)}`, phoneE164: '+2348000000000', subtotalMinor: total, totalMinor: total, deliveryAddressSnapshot: { recipientName: 'Fixture Buyer' }, deliveryMethod: 'next_day', termsAcceptedAt: new Date(), status: 'placed', paymentStatus: 'paid', placedAt: new Date(), ...over })
    .returning();
  for (const l of lines) await t.db.insert(orderItems).values({ orderId: o!.id, productId: l.productId, variantId: l.variantId, skuSnapshot: 's', titleSnapshot: 't', quantity: l.quantity, unitPriceMinor: 1000, lineTotalMinor: 1000 * l.quantity });
  return o!;
}
