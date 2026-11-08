import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { deliveryZones } from '../../db/schema/index.js';

/** `delivery` is the one priced option (a zone's fee and duration); `pickup` is collection from the showroom. */
export const DELIVERY_METHODS = ['delivery', 'pickup'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type Destination = { state: string; area?: string | undefined };

export type DeliveryOption = {
  method: DeliveryMethod;
  available: boolean;
  /** Admin-configured fee for the zone, in minor units. */
  baseFeeMinor: number;
  /** Local-date window (YYYY-MM-DD in the zone's timezone); null when no date applies (pickup). */
  estimate: { earliestDate: string; latestDate: string } | null;
};

// Orders placed before delivery had one price carry the method they were sold under. Their windows stay as they were.
const LEGACY_TRANSIT_DAYS: Record<string, [number, number]> = { same_day: [0, 0], next_day: [1, 1], nationwide: [2, 4] };

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const statesOf = (z: DeliveryZone) => (Array.isArray(z.states) ? z.states.filter((s): s is string => typeof s === 'string').map(normalise) : []);

/**
 * Resolves the zone for a destination from admin-managed configuration, most specific first:
 * 1. a state zone that lists the destination area;
 * 2. the state-wide zone for the destination state (empty `areas`);
 * 3. the nationwide zone whose `states` include the destination state.
 * A state zone that lists areas never covers other areas of its state, so those customers fall through to a nationwide
 * zone if one covers the state. A state with its own zone is never priced by a nationwide one.
 */
export async function resolveZone(db: Db, destination: Destination): Promise<DeliveryZone | undefined> {
  const state = normalise(destination.state);
  const stateZones = await db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.active, true), eq(deliveryZones.scope, 'state'), sql`lower(btrim(${deliveryZones.state})) = ${state}`))
    .orderBy(asc(deliveryZones.name), asc(deliveryZones.id));

  const area = destination.area ? normalise(destination.area) : undefined;
  const areasOf = (z: DeliveryZone) => (Array.isArray(z.areas) ? z.areas.filter((a): a is string => typeof a === 'string').map(normalise) : []);

  if (area) {
    const specific = stateZones.find((z) => areasOf(z).includes(area));
    if (specific) return specific;
  }
  const stateWide = stateZones.find((z) => areasOf(z).length === 0);
  if (stateWide) return stateWide;

  const nationwide = await db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.active, true), eq(deliveryZones.scope, 'nationwide')))
    .orderBy(asc(deliveryZones.name), asc(deliveryZones.id));
  return nationwide.find((z) => statesOf(z).includes(state));
}

function localClock(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Methods the zone offers. A zone with no delivery price is pickup only. */
export function deliveryOptions(zone: DeliveryZone, now: Date = new Date()): DeliveryOption[] {
  const clock = (() => {
    try {
      return localClock(now, zone.timezone);
    } catch {
      return localClock(now, 'Africa/Lagos');
    }
  })();
  const options: DeliveryOption[] = [];
  if (zone.deliveryFeeMinor !== null) {
    options.push({
      method: 'delivery',
      available: true,
      baseFeeMinor: zone.deliveryFeeMinor,
      estimate: { earliestDate: addDays(clock.date, zone.deliveryMinDays), latestDate: addDays(clock.date, zone.deliveryMaxDays) },
    });
  }
  if (zone.pickupEnabled) options.push({ method: 'pickup', available: true, baseFeeMinor: 0, estimate: null });
  return options;
}

export type DeliveryEstimate = { earliestDate: string; latestDate: string };

/** The delivery days saved in an order's address snapshot when it was placed; empty for orders from before they were kept. */
export function promisedDays(snapshot: unknown): { minDays?: number; maxDays?: number } {
  const s = (snapshot ?? {}) as { deliveryMinDays?: unknown; deliveryMaxDays?: unknown };
  return {
    ...(typeof s.deliveryMinDays === 'number' ? { minDays: s.deliveryMinDays } : {}),
    ...(typeof s.deliveryMaxDays === 'number' ? { maxDays: s.deliveryMaxDays } : {}),
  };
}

/**
 * Delivery window for an order that was placed at `placedAt`: the days the zone promised when the order was placed,
 * counted from the local date it was placed. Pickup has no window. Orders from before delivery had one price carry
 * their old method and use its old window.
 */
export function estimateFor(method: string, placedAt: Date, promised?: { minDays?: number; maxDays?: number }, timeZone = 'Africa/Lagos'): DeliveryEstimate | null {
  if (method === 'pickup') return null;
  const legacy = LEGACY_TRANSIT_DAYS[method];
  const from = legacy ? legacy[0] : promised?.minDays;
  const to = legacy ? legacy[1] : promised?.maxDays;
  if (from === undefined || to === undefined) return null;
  const today = localClock(placedAt, timeZone).date;
  return { earliestDate: addDays(today, from), latestDate: addDays(today, to) };
}
