import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { deliveries, orderItems, orderStatusEvents, orders, productMedia, products, reviews } from '../../db/schema/index.js';
import { estimateFor } from '../delivery/zones.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { notFound } from '../../lib/errors.js';

type Order = typeof orders.$inferSelect;

const normaliseOrderNumber = (value: string) => value.trim().toUpperCase();

/** Timeline entries expose only the status and time; internal notes and actors stay private. */
async function timeline(db: Db, orderId: string) {
  const events = await db
    .select({ status: orderStatusEvents.toStatus, from: orderStatusEvents.fromStatus, at: orderStatusEvents.createdAt })
    .from(orderStatusEvents)
    .where(eq(orderStatusEvents.orderId, orderId))
    .orderBy(asc(orderStatusEvents.createdAt), asc(orderStatusEvents.id));
  // Same-status rows are internal annotations (refunds, payment flags), not steps the customer should see.
  return events.filter((e) => e.from !== e.status).map((e) => ({ status: e.status, at: e.at }));
}

const summary = (o: Order, itemCount: number) => ({
  id: o.id,
  orderNumber: o.orderNumber,
  status: o.status,
  paymentStatus: o.paymentStatus,
  currency: o.currency,
  totalMinor: o.totalMinor,
  itemCount,
  placedAt: o.placedAt,
  createdAt: o.createdAt,
});

/** Newest-first order history for one customer, with an opaque keyset cursor on (created_at, id). */
export async function listCustomerOrders(db: Db, customerId: string, input: { limit: number; cursor?: string | undefined }) {
  let after: SQLCursor | undefined;
  if (input.cursor) {
    const [createdAt, id] = decodeCursor(input.cursor, 'orders', 2) as [string, string];
    after = { createdAt, id };
  }
  const rows = await db
    .select({
      order: orders,
      itemCount: // Written out in full: drizzle drops table qualifiers in single-table selects, which would make `id` ambiguous here.
      sql<number>`coalesce((select sum(oi.quantity) from order_items oi where oi.order_id = "orders"."id"), 0)::int`,
      cursorCreatedAt: sql<string>`${orders.createdAt}::text`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customerId),
        after
          ? or(
              sql`${orders.createdAt} < ${after.createdAt}::timestamptz`,
              and(sql`${orders.createdAt} = ${after.createdAt}::timestamptz`, lt(orders.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    data: page.map((r) => summary(r.order, r.itemCount)),
    page: { nextCursor: rows.length > input.limit && last ? encodeCursor({ sort: 'orders', values: [last.cursorCreatedAt, last.order.id] }) : null },
  };
}
type SQLCursor = { createdAt: string; id: string };

/** Full detail of one of the customer's own orders. Another customer's (or a guest) order is a 404. */
export async function getCustomerOrder(db: Db, customerId: string, orderId: string) {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)));
  if (!order) throw notFound('Order not found.');

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.titleSnapshot), asc(orderItems.id));
  const applied = (order.appliedPromotions as { code: string | null; discountMinor: number }[]) ?? [];

  // Product page link and photo for each line, and whether the customer can still review it.
  const productIds = [...new Set(items.map((i) => i.productId).filter((id): id is string => id !== null))];
  const [slugRows, mediaRows, reviewed] = await Promise.all([
    productIds.length ? db.select({ id: products.id, slug: products.slug }).from(products).where(inArray(products.id, productIds)) : [],
    productIds.length
      ? db
          .select({ productId: productMedia.productId, objectKey: productMedia.objectKey, altText: productMedia.altText, width: productMedia.width, height: productMedia.height })
          .from(productMedia)
          .where(inArray(productMedia.productId, productIds))
          .orderBy(desc(productMedia.isCover), asc(productMedia.sortOrder), asc(productMedia.createdAt))
      : [],
    items.length ? db.select({ orderItemId: reviews.orderItemId }).from(reviews).where(and(eq(reviews.customerId, customerId), inArray(reviews.orderItemId, items.map((i) => i.id)))) : [],
  ]);
  const slugById = new Map(slugRows.map((r) => [r.id, r.slug]));
  const imageById = new Map<string, { objectKey: string; altText: string | null; width: number | null; height: number | null }>();
  for (const m of mediaRows) if (!imageById.has(m.productId)) imageById.set(m.productId, { objectKey: m.objectKey, altText: m.altText, width: m.width, height: m.height });
  const reviewedIds = new Set(reviewed.map((r) => r.orderItemId));
  const canReview = order.status === 'delivered' && order.paymentStatus === 'paid';
  const [delivery] = order.status === 'out_for_delivery' ? await db.select().from(deliveries).where(eq(deliveries.orderId, order.id)) : [];

  return {
    ...summary(order, items.reduce((n, i) => n + i.quantity, 0)),
    contact: { phone: order.phoneE164, email: order.email },
    deliveryMethod: order.deliveryMethod,
    deliveryAddress: order.deliveryAddressSnapshot,
    estimate: estimateFor(order.deliveryMethod, order.placedAt ?? order.createdAt),
    /** Rider details, only while the order is out for delivery. */
    rider: delivery && (delivery.riderName || delivery.riderPhoneE164) ? { name: delivery.riderName, phone: delivery.riderPhoneE164, carrier: delivery.carrier, trackingReference: delivery.trackingReference } : null,
    items: items.map((i) => ({
      id: i.id,
      slug: i.productId ? (slugById.get(i.productId) ?? null) : null,
      image: i.productId ? (imageById.get(i.productId) ?? null) : null,
      /** True once the order is delivered and this line has no review from the customer yet. */
      reviewable: canReview && i.productId !== null && !reviewedIds.has(i.id),
      productId: i.productId,
      variantId: i.variantId,
      sku: i.skuSnapshot,
      title: i.titleSnapshot,
      options: i.optionsSnapshot,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      discountMinor: i.discountMinor,
      lineTotalMinor: i.lineTotalMinor,
    })),
    totals: {
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
    },
    promotions: applied.map((p) => ({ code: p.code, discountMinor: p.discountMinor })),
    reservationExpiresAt: order.status === 'pending_payment' ? order.reservationExpiresAt : null,
    timeline: await timeline(db, order.id),
  };
}

/**
 * Guest lookup by order number plus the phone on the order. Any mismatch is
 * the same 404, so the endpoint cannot confirm that an order number exists.
 * Only a minimal timeline is returned: no address, contact or line items.
 */
export async function trackOrder(db: Db, input: { orderNumber: string; phone: string }) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNumber, normaliseOrderNumber(input.orderNumber)), eq(orders.phoneE164, input.phone)));
  if (!order) throw notFound('We could not find an order matching those details.');
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryMethod: order.deliveryMethod,
    placedAt: order.placedAt,
    timeline: await timeline(db, order.id),
  };
}
