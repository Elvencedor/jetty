import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { customers, reviews } from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { notFound } from '../../lib/errors.js';
import { likeContains } from '../../lib/sql.js';

const likeOf = likeContains;
export const SEGMENTS = [
  { key: 'vip', label: 'VIP', rule: '5 or more orders, or ₦1,000,000 spent' },
  { key: 'new', label: 'New', rule: 'First order in the last 30 days' },
  { key: 'returning', label: 'Returning', rule: '2 or more orders' },
  { key: 'lapsed', label: 'Lapsed', rule: 'No order in the last 120 days' },
] as const;
export type SegmentKey = (typeof SEGMENTS)[number]['key'];

const VIP_SPEND_MINOR = 100_000_000;
const DAY_MS = 86_400_000;

/** The same rules twice: in SQL (to filter and count) and in JS (to tag a row), pinned together by a test. */
const segmentSql: Record<SegmentKey, ReturnType<typeof sql>> = {
  vip: sql`(s.order_count >= 5 or s.ltv >= ${VIP_SPEND_MINOR})`,
  new: sql`(s.order_count >= 1 and s.first_order_at >= now() - interval '30 days')`,
  returning: sql`(s.order_count >= 2)`,
  lapsed: sql`(s.order_count >= 1 and s.last_order_at < now() - interval '120 days')`,
};

function segmentsOf(row: { orderCount: number; ltv: number; firstOrderAt: Date | null; lastOrderAt: Date | null }, now = Date.now()): SegmentKey[] {
  const out: SegmentKey[] = [];
  if (row.orderCount >= 5 || row.ltv >= VIP_SPEND_MINOR) out.push('vip');
  if (row.orderCount >= 1 && row.firstOrderAt && row.firstOrderAt.getTime() >= now - 30 * DAY_MS) out.push('new');
  if (row.orderCount >= 2) out.push('returning');
  if (row.orderCount >= 1 && row.lastOrderAt && row.lastOrderAt.getTime() < now - 120 * DAY_MS) out.push('lapsed');
  return out;
}

/** Everyone plus the size of each segment, with the rule shown to staff. */
export async function customerSegments(db: Db) {
  const [row] = (await db.execute(sql`
    select count(*)::int as everyone,
      ${sql.join(SEGMENTS.map((g) => sql`count(*) filter (where ${segmentSql[g.key]})::int as ${sql.raw(g.key)}`), sql`, `)}
    from customers c cross join lateral (${stats}) s`)) as unknown as Record<string, number>[];
  return { everyone: row!.everyone!, segments: SEGMENTS.map((g) => ({ ...g, count: row![g.key]! })) };
}

/** Who the customer last said they were and where: accounts have no name of their own, so it comes from their latest order. */
const latestOrder = sql`
  select o.delivery_address_snapshot->>'recipientName' as recipient,
    coalesce(nullif(o.delivery_address_snapshot->>'area', ''), o.delivery_address_snapshot->>'city') as area,
    o.delivery_address_snapshot->>'state' as state,
    o.delivery_address_snapshot->>'addressLine1' as line1
  from orders o where o.customer_id = c.id order by o.created_at desc limit 1`;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Lifetime value counts paid orders only, net of fully refunded ones. */
const stats = sql`
  select count(*) filter (where o.payment_status = 'paid')::int as order_count,
    coalesce(sum(o.total_minor) filter (where o.payment_status = 'paid'), 0)::bigint as ltv,
    min(o.placed_at) filter (where o.payment_status = 'paid') as first_order_at,
    max(o.placed_at) as last_order_at
  from orders o where o.customer_id = c.id`;

export async function listAdminCustomers(db: Db, input: { q?: string | undefined; segment?: SegmentKey | undefined; sort: 'newest' | 'spend'; limit: number; cursor?: string | undefined }) {
  const where = [sql`true`];
  if (input.segment) where.push(segmentSql[input.segment]);
  if (input.q) where.push(sql`(c.phone_e164 like ${likeOf(input.q)} or c.email ilike ${likeOf(input.q)})`);
  const spend = input.sort === 'spend';
  let after = sql``;
  if (input.cursor) {
    const values = decodeCursor(input.cursor, `admin-customers:${input.sort}`, 2);
    after = spend ? sql`and (s.ltv, c.id) < (${values[0]}::bigint, ${values[1]}::uuid)` : sql`and (c.created_at, c.id) < (${values[0]}::timestamptz, ${values[1]}::uuid)`;
  }
  const rows = (await db.execute(sql`
    select c.id, c.phone_e164, c.email, c.status, c.phone_verified_at, c.created_at, s.order_count, s.ltv, s.first_order_at, s.last_order_at,
      ${spend ? sql`s.ltv::text` : sql`c.created_at::text`} as cur_a, lo.recipient, lo.area, lo.state
    from customers c cross join lateral (${stats}) s
    left join lateral (${latestOrder}) lo on true
    where ${sql.join(where, sql` and `)} ${after}
    order by ${spend ? sql`s.ltv desc, c.id desc` : sql`c.created_at desc, c.id desc`} limit ${input.limit + 1}`)) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map((r) => ({
      id: r.id as string, name: (r.recipient as string | null) ?? null, area: (r.area as string | null) ?? null, state: (r.state as string | null) ?? null,
      phone: (r.phone_e164 as string | null) ?? null, email: (r.email as string | null) ?? null, status: r.status as string,
      phoneVerified: Boolean(r.phone_verified_at), orderCount: r.order_count as number, lifetimeValueMinor: Number(r.ltv), lastOrderAt: iso(r.last_order_at), createdAt: iso(r.created_at),
      segments: segmentsOf({ orderCount: r.order_count as number, ltv: Number(r.ltv), firstOrderAt: r.first_order_at ? new Date(r.first_order_at as string) : null, lastOrderAt: r.last_order_at ? new Date(r.last_order_at as string) : null }),
    })),
    page: { nextCursor: hasMore && last ? encodeCursor({ sort: `admin-customers:${input.sort}`, values: [String(last.cur_a), String(last.id)] }) : null },
  };
}

export async function getAdminCustomer(db: Db, id: string) {
  const [c] = await db.select({ id: customers.id, phone: customers.phoneE164, email: customers.email, status: customers.status, phoneVerifiedAt: customers.phoneVerifiedAt, emailVerifiedAt: customers.emailVerifiedAt, createdAt: customers.createdAt }).from(customers).where(eq(customers.id, id));
  if (!c) throw notFound('Customer not found.');
  const [[agg], recent, [last]] = await Promise.all([
    db.execute(sql`select s.order_count, s.ltv, s.last_order_at from customers c cross join lateral (${stats}) s where c.id = ${id}`) as unknown as Promise<Record<string, unknown>[]>,
    db.execute(sql`select id, order_number, status, payment_status, total_minor, created_at from orders where customer_id = ${id} order by created_at desc limit 10`) as unknown as Promise<Record<string, unknown>[]>,
    db.execute(sql`select lo.recipient, lo.area, lo.state, lo.line1 from customers c cross join lateral (${latestOrder}) lo where c.id = ${id}`) as unknown as Promise<Record<string, unknown>[]>,
  ]);
  return {
    customer: c,
    /** From the latest order: the name given, and where it went. Null for a customer who has not ordered. */
    lastOrder: last ? { name: (last.recipient as string | null) ?? null, area: (last.area as string | null) ?? null, state: (last.state as string | null) ?? null, addressLine: (last.line1 as string | null) ?? null } : null,
    orderCount: agg!.order_count as number,
    lifetimeValueMinor: Number(agg!.ltv),
    lastOrderAt: iso(agg!.last_order_at),
    recentOrders: recent.map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, paymentStatus: o.payment_status, totalMinor: Number(o.total_minor), createdAt: iso(o.created_at) })),
  };
}

// ----------------------------------------------------------------- reviews

export async function listAdminReviews(db: Db, input: { status?: string | undefined; productId?: string | undefined; limit: number; cursor?: string | undefined }) {
  const where = [sql`true`];
  if (input.status) where.push(sql`r.status = ${input.status}`);
  if (input.productId) where.push(sql`r.product_id = ${input.productId}`);
  let after = sql``;
  if (input.cursor) {
    const [at, id] = decodeCursor(input.cursor, 'admin-reviews', 2);
    after = sql`and (r.created_at, r.id) < (${at}::timestamptz, ${id}::uuid)`;
  }
  const rows = (await db.execute(sql`
    select r.id, r.product_id, p.title as product_title, r.customer_id, c.phone_e164, c.email, r.rating, r.title, r.body, r.location, r.status,
      r.verified_buyer, r.created_at, r.moderated_at, oi.options_snapshot as variant, r.created_at::text as cur_at
    from reviews r join products p on p.id = r.product_id join customers c on c.id = r.customer_id
    left join order_items oi on oi.id = r.order_item_id
    where ${sql.join(where, sql` and `)} ${after} order by r.created_at desc, r.id desc limit ${input.limit + 1}`)) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const mask = (p: string | null) => (p ? `${p.slice(0, 4)}••••${p.slice(-3)}` : null);
  const maskEmail = (e: string | null) => (e ? `${e.slice(0, 1)}•••${e.slice(e.indexOf('@'))}` : null);
  // The total for the filter, on the first page only (the nav badge counts the pending queue with it).
  const total = input.cursor ? null : Number(((await db.execute(sql`select count(*)::int as n from reviews r where ${sql.join(where, sql` and `)}`)) as unknown as { n: number }[])[0]!.n);
  return {
    data: page.map((r) => ({
      id: r.id as string, productId: r.product_id as string, productTitle: r.product_title as string, customerId: r.customer_id as string, customerPhone: mask(r.phone_e164 as string | null), customerEmail: maskEmail(r.email as string | null),
      rating: r.rating as number, title: (r.title as string | null) ?? null, body: (r.body as string | null) ?? null, location: (r.location as string | null) ?? null,
      status: r.status as string, verifiedBuyer: r.verified_buyer as boolean, variant: r.variant ?? null, createdAt: iso(r.created_at), moderatedAt: iso(r.moderated_at),
    })),
    page: { total, nextCursor: hasMore && last ? encodeCursor({ sort: 'admin-reviews', values: [String(last.cur_at), String(last.id)] }) : null },
  };
}

export async function moderateReview(db: Db, id: string, status: 'approved' | 'rejected' | 'hidden') {
  const [before] = await db.select({ status: reviews.status }).from(reviews).where(eq(reviews.id, id));
  if (!before) throw notFound('Review not found.');
  const [after] = await db.update(reviews).set({ status, moderatedAt: new Date() }).where(eq(reviews.id, id)).returning({ id: reviews.id, status: reviews.status, moderatedAt: reviews.moderatedAt });
  return { before: before.status, after: after! };
}
