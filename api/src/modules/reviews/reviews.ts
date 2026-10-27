import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { orderItems, orders, products, reviews } from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { visibleProduct } from '../catalog/listing.js';

export const REVIEW_SORTS = ['newest', 'highest', 'lowest'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

// Keyset order per sort; every tuple ends in the unique id so paging is stable.
const ORDER: Record<ReviewSort, { cols: string[]; dir: 'asc' | 'desc'; types: string[] }> = {
  newest: { cols: ['r.created_at', 'r.id'], dir: 'desc', types: ['timestamptz', 'uuid'] },
  highest: { cols: ['r.rating', 'r.created_at', 'r.id'], dir: 'desc', types: ['int', 'timestamptz', 'uuid'] },
  lowest: { cols: ['r.rating', 'r.created_at', 'r.id'], dir: 'asc', types: ['int', 'timestamptz', 'uuid'] },
};

/** Approved reviews and the star breakdown for a visible product; unknown or hidden products are a 404. */
export async function listProductReviews(
  db: Db,
  productId: string,
  input: { sort: ReviewSort; rating?: number | undefined; limit: number; cursor?: string | undefined },
) {
  const [visible] = (await db.execute(sql`select p.id from products p where p.id = ${productId} and ${visibleProduct}`)) as unknown as { id: string }[];
  if (!visible) throw notFound('Product not found.');

  const def = ORDER[input.sort];
  const cursor = input.cursor
    ? (() => {
        const values = decodeCursor(input.cursor, `reviews:${input.sort}`, def.cols.length);
        const params = sql.join(def.types.map((t, i) => sql`${values[i]}::${sql.raw(t)}`), sql`, `);
        return sql`and (${sql.raw(def.cols.join(', '))}) ${sql.raw(def.dir === 'desc' ? '<' : '>')} (${params})`;
      })()
    : sql``;

  const [rows, breakdown] = await Promise.all([
    db.execute(sql`
      select r.id, r.rating, r.title, r.body, r.location, r.verified_buyer, r.created_at,
        oi.options_snapshot as variant,
        ${sql.raw(def.cols.map((c, i) => `${c}::text as cur_${i}`).join(', '))}
      from reviews r left join order_items oi on oi.id = r.order_item_id
      where r.product_id = ${productId} and r.status = 'approved'
        ${input.rating ? sql`and r.rating = ${input.rating}` : sql``} ${cursor}
      order by ${sql.raw(def.cols.map((c) => `${c} ${def.dir}`).join(', '))}
      limit ${input.limit + 1}`) as unknown as Promise<Record<string, unknown>[]>,
    db.execute(sql`
      select rating, count(*)::int as count from reviews
      where product_id = ${productId} and status = 'approved' group by rating`) as unknown as Promise<{ rating: number; count: number }[]>,
  ]);

  const stars: Record<'1' | '2' | '3' | '4' | '5', number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let total = 0;
  let sum = 0;
  for (const b of breakdown) {
    stars[String(b.rating) as keyof typeof stars] = b.count;
    total += b.count;
    sum += b.rating * b.count;
  }

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  return {
    summary: { average: total ? Math.round((sum / total) * 100) / 100 : 0, count: total, breakdown: stars },
    data: page.map((r) => ({
      id: r.id as string,
      rating: r.rating as number,
      title: (r.title as string | null) ?? null,
      body: (r.body as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      verifiedBuyer: r.verified_buyer as boolean,
      variant: (r.variant as Record<string, unknown> | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
    page: { nextCursor: hasMore && last ? encodeCursor({ sort: `reviews:${input.sort}`, values: def.cols.map((_, i) => String(last[`cur_${i}`])) }) : null },
  };
}

export type ReviewInput = { orderItemId: string; rating: number; title?: string | undefined; body?: string | undefined; location?: string | undefined };

/**
 * Verified-purchase review. The customer must own a paid, delivered order
 * containing the item, and may review each purchased item once. Reviews start
 * in moderation and are invisible to the storefront until approved.
 */
export async function submitReview(db: Db, customerId: string, input: ReviewInput) {
  const [item] = await db
    .select({ productId: orderItems.productId, orderStatus: orders.status, paymentStatus: orders.paymentStatus })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(and(eq(orderItems.id, input.orderItemId), eq(orders.customerId, customerId)));
  // Someone else's item and a nonexistent one look the same.
  if (!item || !item.productId) throw notFound('Order item not found.');
  if (item.paymentStatus !== 'paid' || item.orderStatus !== 'delivered') {
    throw unprocessable('REVIEW_NOT_ELIGIBLE', 'You can review an item once your order has been delivered.');
  }

  const inserted = await db
    .insert(reviews)
    .values({
      productId: item.productId,
      customerId,
      orderItemId: input.orderItemId,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body ?? null,
      location: input.location ?? null,
      verifiedBuyer: true,
    })
    .onConflictDoNothing()
    .returning({ id: reviews.id, status: reviews.status });
  if (inserted.length === 0) throw conflict('REVIEW_EXISTS', 'You have already reviewed this item.');
  return { id: inserted[0]!.id, status: inserted[0]!.status };
}
