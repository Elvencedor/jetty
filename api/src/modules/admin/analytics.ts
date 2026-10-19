import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { unprocessable } from '../../lib/errors.js';

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 366;
export const TIMEZONE = 'Africa/Lagos';

export type Range = { from: Date; to: Date };
export type Periods = { current: Range; previous: Range };

/** `from` inclusive, `to` exclusive. The previous period is the same length, immediately before. */
export function periods(from: Date | undefined, to: Date | undefined, now: Date = new Date()): Periods {
  const end = to ?? now;
  const start = from ?? new Date(end.getTime() - 30 * DAY);
  if (start >= end) throw unprocessable('VALIDATION_FAILED', 'from must be before to.', [{ path: 'from', code: 'any.invalid' }]);
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY) throw unprocessable('VALIDATION_FAILED', `The range can be at most ${MAX_RANGE_DAYS} days.`, [{ path: 'from', code: 'any.invalid' }]);
  const length = end.getTime() - start.getTime();
  return { current: { from: start, to: end }, previous: { from: new Date(start.getTime() - length), to: start } };
}

const iso = (d: Date) => d.toISOString();
const changePct = (current: number, previous: number): number | null => (previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10);
const compare = (current: number | null, previous: number | null) => ({ current, previous, changePct: current === null || previous === null ? null : changePct(current, previous) });

/** Sales are paid orders by the time payment was confirmed; refunded orders are not sales. */
async function sales(db: Db, r: Range) {
  const [row] = (await db.execute(sql`
    select count(*)::int as orders, coalesce(sum(total_minor), 0)::bigint as revenue
    from orders where payment_status = 'paid' and placed_at >= ${iso(r.from)}::timestamptz and placed_at < ${iso(r.to)}::timestamptz`)) as unknown as { orders: number; revenue: string }[];
  return { orders: row!.orders, revenue: Number(row!.revenue) };
}

/** Distinct browsing sessions; null when no events were recorded, so a missing feed is not shown as a 0% conversion. */
async function sessions(db: Db, r: Range): Promise<number | null> {
  const [row] = (await db.execute(sql`
    select count(distinct session_id)::int as n from analytics_events
    where occurred_at >= ${iso(r.from)}::timestamptz and occurred_at < ${iso(r.to)}::timestamptz and session_id is not null`)) as unknown as { n: number }[];
  return row!.n > 0 ? row!.n : null;
}

async function topProducts(db: Db, r: Range, limit: number) {
  const rows = (await db.execute(sql`
    select oi.product_id, coalesce(p.title, max(oi.title_snapshot)) as title, sum(oi.quantity)::int as units, sum(oi.line_total_minor)::bigint as revenue
    from order_items oi join orders o on o.id = oi.order_id left join products p on p.id = oi.product_id
    where o.payment_status = 'paid' and o.placed_at >= ${iso(r.from)}::timestamptz and o.placed_at < ${iso(r.to)}::timestamptz
    group by oi.product_id, p.title order by revenue desc, units desc limit ${limit}`)) as unknown as Record<string, unknown>[];
  return rows.map((x) => ({ productId: (x.product_id as string | null) ?? null, title: x.title as string, units: x.units as number, revenueMinor: Number(x.revenue) }));
}

/** A product in several categories counts toward each, so category figures can add up to more than total sales. */
async function salesByCategory(db: Db, r: Range) {
  const rows = (await db.execute(sql`
    select c.id, c.name, sum(oi.quantity)::int as units, sum(oi.line_total_minor)::bigint as revenue
    from order_items oi join orders o on o.id = oi.order_id
    join product_categories pc on pc.product_id = oi.product_id join categories c on c.id = pc.category_id
    where o.payment_status = 'paid' and o.placed_at >= ${iso(r.from)}::timestamptz and o.placed_at < ${iso(r.to)}::timestamptz
    group by c.id, c.name order by revenue desc`)) as unknown as Record<string, unknown>[];
  return rows.map((x) => ({ categoryId: x.id as string, name: x.name as string, units: x.units as number, revenueMinor: Number(x.revenue) }));
}

export async function actionCounts(db: Db) {
  const [row] = (await db.execute(sql`
    select
      count(*) filter (where status = 'placed')::int as to_pack,
      count(*) filter (where status = 'packed')::int as to_dispatch,
      count(*) filter (where status = 'out_for_delivery')::int as out_for_delivery,
      count(*) filter (where status = 'payment_exception')::int as payment_exceptions,
      count(*) filter (where status = 'pending_payment' and (reservation_expires_at is null or reservation_expires_at > now())
        and exists (select 1 from payment_attempts a where a.order_id = orders.id and a.method = 'bank_transfer' and a.status in ('initializing', 'pending')))::int as awaiting_transfer
    from orders`)) as unknown as Record<string, number>[];
  return { toPack: row!.to_pack!, toDispatch: row!.to_dispatch!, outForDelivery: row!.out_for_delivery!, awaitingTransfer: row!.awaiting_transfer!, paymentExceptions: row!.payment_exceptions! };
}

export async function dashboard(db: Db, p: Periods) {
  const [cur, prev, curSessions, prevSessions, top, categories, actions] = await Promise.all([
    sales(db, p.current),
    sales(db, p.previous),
    sessions(db, p.current),
    sessions(db, p.previous),
    topProducts(db, p.current, 5),
    salesByCategory(db, p.current),
    actionCounts(db),
  ]);
  const aov = (s: { orders: number; revenue: number }) => (s.orders ? Math.round(s.revenue / s.orders) : 0);
  // Orders can exceed sessions if events are blocked by the browser, so the rate is capped at 100%.
  const rate = (orders: number, n: number | null) => (n === null ? null : Math.min(Math.round((orders / n) * 10000) / 100, 100));
  return {
    range: { from: iso(p.current.from), to: iso(p.current.to), previous: { from: iso(p.previous.from), to: iso(p.previous.to) } },
    currency: 'NGN',
    kpis: {
      revenueMinor: compare(cur.revenue, prev.revenue),
      orders: compare(cur.orders, prev.orders),
      averageOrderValueMinor: compare(aov(cur), aov(prev)),
      conversionRatePct: compare(rate(cur.orders, curSessions), rate(prev.orders, prevSessions)),
      sessions: compare(curSessions, prevSessions),
    },
    actionCounts: actions,
    topProducts: top,
    salesByCategory: categories,
  };
}

export const INTERVALS = ['day', 'week', 'month'] as const;
export type Interval = (typeof INTERVALS)[number];

/**
 * Revenue per Lagos-local bucket for both periods. Each series is gap-filled on its own; for `day` they line up
 * one-to-one, but week and month buckets of the previous period start on different dates, so match by position only for day.
 */
export async function revenueSeries(db: Db, p: Periods, interval: Interval) {
  const bucket = (r: Range) =>
    db.execute(sql`
      select to_char(date_trunc(${interval}, placed_at at time zone ${TIMEZONE}), 'YYYY-MM-DD') as bucket,
        count(*)::int as orders, coalesce(sum(total_minor), 0)::bigint as revenue
      from orders where payment_status = 'paid' and placed_at >= ${iso(r.from)}::timestamptz and placed_at < ${iso(r.to)}::timestamptz
      group by 1 order by 1`) as unknown as Promise<{ bucket: string; orders: number; revenue: string }[]>;
  const [cur, prev] = await Promise.all([bucket(p.current), bucket(p.previous)]);

  // Fill empty buckets with zero so the series has no gaps.
  const keys = (r: Range) => {
    const out: string[] = [];
    const lagos = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d);
    let cursor = new Date(`${lagos(r.from)}T00:00:00Z`);
    const last = new Date(`${lagos(new Date(r.to.getTime() - 1))}T00:00:00Z`);
    const startOfBucket = (d: Date) => {
      const x = new Date(d);
      if (interval === 'week') x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      if (interval === 'month') x.setUTCDate(1);
      return x;
    };
    cursor = startOfBucket(cursor);
    while (cursor <= last) {
      out.push(cursor.toISOString().slice(0, 10));
      if (interval === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
      else if (interval === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return out;
  };
  const fill = (r: Range, rows: typeof cur) => {
    const by = new Map(rows.map((x) => [x.bucket, x]));
    return keys(r).map((k) => ({ bucket: k, orders: by.get(k)?.orders ?? 0, revenueMinor: Number(by.get(k)?.revenue ?? 0) }));
  };
  return {
    interval,
    timezone: TIMEZONE,
    currency: 'NGN',
    range: { from: iso(p.current.from), to: iso(p.current.to), previous: { from: iso(p.previous.from), to: iso(p.previous.to) } },
    current: fill(p.current, cur),
    previous: fill(p.previous, prev),
  };
}

export async function productAnalytics(db: Db, p: Periods) {
  const [products, categories] = await Promise.all([topProducts(db, p.current, 10), salesByCategory(db, p.current)]);
  return { range: { from: iso(p.current.from), to: iso(p.current.to) }, currency: 'NGN', topProducts: products, salesByCategory: categories };
}
