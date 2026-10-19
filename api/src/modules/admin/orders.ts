import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { adminAuditLog, deliveries, notificationOutbox, orderItems, orders, orderStatusEvents, paymentAttempts, refunds, customers } from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { apiError, conflict, notFound } from '../../lib/errors.js';
import { PaymentIndeterminateError, type PaymentProvider } from '../payments/provider.js';
import { MANUAL_TRANSACTION_PREFIX, settleTransaction, type Settlement } from '../payments/settle.js';
import { likeContains } from '../../lib/sql.js';

type OrderStatus = typeof orders.$inferSelect.status;

export type OrderListInput = {
  q?: string | undefined;
  status?: OrderStatus | undefined;
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded' | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit: number;
  cursor?: string | undefined;
};

/** Newest first, keyset on (created_at, id). `q` matches order number, phone, email or recipient name. */
export async function listAdminOrders(db: Db, input: OrderListInput) {
  const where = [sql`true`];
  if (input.status) where.push(sql`o.status = ${input.status}`);
  if (input.paymentStatus) where.push(sql`o.payment_status = ${input.paymentStatus}`);
  if (input.from) where.push(sql`o.created_at >= ${input.from.toISOString()}::timestamptz`);
  if (input.to) where.push(sql`o.created_at < ${input.to.toISOString()}::timestamptz`);
  if (input.q) {
    const like = likeContains(input.q);
    where.push(sql`(o.order_number ilike ${like} or o.phone_e164 like ${like} or o.email ilike ${like} or o.delivery_address_snapshot->>'recipientName' ilike ${like})`);
  }
  let after = sql``;
  if (input.cursor) {
    const [at, id] = decodeCursor(input.cursor, 'admin-orders', 2);
    after = sql`and (o.created_at, o.id) < (${at}::timestamptz, ${id}::uuid)`;
  }
  const rows = (await db.execute(sql`
    select o.id, o.order_number, o.status, o.payment_status, o.total_minor, o.currency, o.delivery_method, o.phone_e164, o.email,
      o.delivery_address_snapshot->>'recipientName' as recipient, o.customer_id is not null as has_account,
      o.placed_at, o.created_at, o.created_at::text as cur_at,
      (select coalesce(sum(quantity), 0)::int from order_items oi where oi.order_id = o.id) as item_count
    from orders o where ${sql.join(where, sql` and `)} ${after}
    order by o.created_at desc, o.id desc limit ${input.limit + 1}`)) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map((r) => ({
      id: r.id as string,
      orderNumber: r.order_number as string,
      status: r.status as string,
      paymentStatus: r.payment_status as string,
      totalMinor: Number(r.total_minor),
      currency: r.currency as string,
      deliveryMethod: r.delivery_method as string,
      phone: r.phone_e164 as string,
      email: (r.email as string | null) ?? null,
      recipientName: (r.recipient as string | null) ?? null,
      hasAccount: r.has_account as boolean,
      itemCount: r.item_count as number,
      placedAt: r.placed_at ? new Date(r.placed_at as string).toISOString() : null,
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
    page: { nextCursor: hasMore && last ? encodeCursor({ sort: 'admin-orders', values: [String(last.cur_at), String(last.id)] }) : null },
  };
}

export async function getAdminOrder(db: Db, id: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw notFound('Order not found.');
  const [items, events, attempts, [delivery], orderRefunds, notes, customer] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)),
    db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, id)).orderBy(asc(orderStatusEvents.createdAt), asc(orderStatusEvents.id)),
    db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, id)).orderBy(asc(paymentAttempts.createdAt)),
    db.select().from(deliveries).where(eq(deliveries.orderId, id)),
    db.select().from(refunds).where(eq(refunds.orderId, id)),
    db
      .select({ id: adminAuditLog.id, at: adminAuditLog.createdAt, adminUserId: adminAuditLog.adminUserId, note: sql<string>`${adminAuditLog.afterJson}->>'note'` })
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.resourceType, 'order'), eq(adminAuditLog.resourceId, id), eq(adminAuditLog.action, 'order.note')))
      .orderBy(asc(adminAuditLog.createdAt)),
    order.customerId ? db.select({ id: customers.id, phone: customers.phoneE164, email: customers.email, status: customers.status }).from(customers).where(eq(customers.id, order.customerId)) : Promise.resolve([]),
  ]);
  const { guestCheckoutTokenHash: _hash, guestCheckoutTokenExpiresAt: _exp, ...safe } = order;
  return {
    order: safe,
    customer: customer[0] ?? null,
    items,
    timeline: events,
    payments: attempts.map((a) => ({
      id: a.id, provider: a.provider, reference: a.providerReference, method: a.method, status: a.status, amountMinor: a.amountMinor, currency: a.currency,
      paidAt: a.paidAt, createdAt: a.createdAt, reconciliation: (a.metadataRedacted as Record<string, unknown>).reconciliation ?? null,
    })),
    delivery: delivery ?? null,
    refunds: orderRefunds,
    notes,
  };
}

// ------------------------------------------------------------ fulfilment

const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { placed: 'packed', packed: 'out_for_delivery', out_for_delivery: 'delivered' };

export function allowedNext(status: OrderStatus, deliveryMethod: string): OrderStatus[] {
  const next = NEXT[status];
  if (!next) return [];
  // Collection orders are never dispatched: packed means ready, and the next step is collected.
  if (deliveryMethod === 'pickup' && status === 'packed') return ['delivered'];
  return [next];
}

export const FULFILMENT_STATUSES = ['packed', 'out_for_delivery', 'delivered'] as const;

/**
 * Moves a paid order forward one step. The order row is locked, so two admins
 * (or an admin and a payment event) cannot both act on the same state. Every
 * step appends a timeline event and queues the customer's notification in the
 * same transaction, so a notification is sent if and only if the step happened.
 */
export async function advanceOrder(db: Db, adminId: string, orderId: string, to: (typeof FULFILMENT_STATUSES)[number], note: string | undefined, now: Date = new Date()) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw notFound('Order not found.');
    if (order.paymentStatus !== 'paid') throw conflict('ORDER_NOT_PAID', 'Only a paid order can be fulfilled.');
    const allowed = allowedNext(order.status, order.deliveryMethod);
    if (!allowed.includes(to)) {
      throw conflict('INVALID_TRANSITION', `An order that is ${order.status.replaceAll('_', ' ')} cannot move to ${to.replaceAll('_', ' ')}.`, [{ from: order.status, to, allowed }]);
    }

    await tx.update(orders).set({ status: to }).where(eq(orders.id, orderId));
    await tx.insert(orderStatusEvents).values({ orderId, fromStatus: order.status, toStatus: to, actorType: 'admin', actorId: adminId, note: note ?? null });
    await tx
      .insert(deliveries)
      .values({ orderId, method: order.deliveryMethod, status: to, ...(to === 'delivered' ? { deliveredAt: now } : {}) })
      .onConflictDoUpdate({ target: deliveries.orderId, set: { status: to, ...(to === 'delivered' ? { deliveredAt: now } : {}), updatedAt: now } });

    const payload = { orderId, orderNumber: order.orderNumber, deliveryMethod: order.deliveryMethod };
    await tx.insert(notificationOutbox).values([
      { eventType: `order.${to}`, recipient: order.phoneE164, channel: 'sms', payload },
      ...(order.email ? [{ eventType: `order.${to}`, recipient: order.email, channel: 'email', payload }] : []),
    ]);
    return { orderId, from: order.status, to, orderNumber: order.orderNumber };
  });
}

// ----------------------------------------------------- bank-transfer confirm

export type ConfirmResult = { outcome: Settlement['outcome'] | 'already_paid'; mode: 'provider' | 'manual' | 'none'; orderId: string; status: OrderStatus; paymentStatus: string };

/**
 * Confirms a bank transfer. The provider is asked first: if it reports the
 * charge as successful the normal settlement runs. Only when the provider cannot
 * confirm (or is not configured) may an admin settle by hand, with a written
 * reason that is audited. Safe to repeat: a paid order just reports itself.
 */
export async function confirmTransfer(db: Db, provider: PaymentProvider | undefined, orderId: string, manualReason: string | undefined, now: Date = new Date()): Promise<ConfirmResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw notFound('Order not found.');
  const done = (outcome: ConfirmResult['outcome'], mode: ConfirmResult['mode'], o: typeof order): ConfirmResult => ({ outcome, mode, orderId, status: o.status, paymentStatus: o.paymentStatus });
  if (order.paymentStatus === 'paid') return done('already_paid', 'none', order);

  const [attempt] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(desc(paymentAttempts.createdAt)).limit(1);
  if (!attempt || attempt.method !== 'bank_transfer') throw conflict('NOT_A_TRANSFER_ORDER', 'This order was not placed with bank transfer.');
  if (order.status !== 'pending_payment') throw conflict('ORDER_NOT_PAYABLE', `This order is ${order.status.replaceAll('_', ' ')} and can no longer be confirmed as paid.`);

  const reload = async () => (await db.select().from(orders).where(eq(orders.id, orderId)))[0]!;

  if (provider) {
    try {
      const verified = await provider.verify(attempt.providerReference);
      if (verified.found && verified.status === 'success') {
        const settled = await settleTransaction(db, provider.name, verified, now);
        return done(settled.outcome, 'provider', await reload());
      }
    } catch (err) {
      if (!(err instanceof PaymentIndeterminateError)) throw err;
      if (!manualReason) throw apiError(503, 'PAYMENT_VERIFICATION_UNAVAILABLE', 'The payment provider could not be reached. Try again shortly.');
    }
  }
  if (!manualReason) {
    throw conflict('TRANSFER_NOT_CONFIRMED', 'The payment provider has not received this transfer. Provide a reason to confirm it manually.', [{ reference: attempt.providerReference }]);
  }

  const settled = await settleTransaction(
    db,
    attempt.provider,
    { found: true, reference: attempt.providerReference, status: 'success', amountMinor: attempt.amountMinor, currency: attempt.currency, transactionId: `${MANUAL_TRANSACTION_PREFIX}${attempt.id}`, paidAt: now },
    now,
  );
  return done(settled.outcome, 'manual', await reload());
}
