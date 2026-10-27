import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { deliveryZones } from '../../db/schema/index.js';

export const DELIVERY_METHODS = ['same_day', 'next_day', 'nationwide', 'pickup'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type Destination = { state: string; area?: string | undefined };

export type DeliveryOption = {
  method: DeliveryMethod;
  available: boolean;
  reason?: 'CUTOFF_PASSED';
  /** Admin-configured fee for the zone, in minor units. */
  baseFeeMinor: number;
  /** Local-date window (YYYY-MM-DD in the zone's timezone); null when no date applies (pickup). */
  estimate: { earliestDate: string; latestDate: string } | null;
};

// Transit windows from FEATURES.md CHK-04; fees and cutoffs are admin-configured, these are not.
const TRANSIT_DAYS: Record<Exclude<DeliveryMethod, 'pickup'>, [number, number]> = {
  same_day: [0, 0],
  next_day: [1, 1],
  nationwide: [2, 4],
};

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Resolves the zone for a destination from admin-managed configuration.
 * A zone that lists the destination area wins over a state-wide zone (empty
 * `areas`); a zone that lists areas never covers other areas of its state.
 */
export async function resolveZone(db: Db, destination: Destination): Promise<DeliveryZone | undefined> {
  const zones = await db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.active, true), sql`lower(btrim(${deliveryZones.state})) = ${normalise(destination.state)}`))
    .orderBy(asc(deliveryZones.name), asc(deliveryZones.id));

  const area = destination.area ? normalise(destination.area) : undefined;
  const areasOf = (z: DeliveryZone) => (Array.isArray(z.areas) ? z.areas.filter((a): a is string => typeof a === 'string').map(normalise) : []);

  if (area) {
    const specific = zones.find((z) => areasOf(z).includes(area));
    if (specific) return specific;
  }
  return zones.find((z) => areasOf(z).length === 0);
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

function cutoffMinutes(cutoff: string | null): number | null | 'invalid' {
  if (cutoff === null) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(cutoff);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 'invalid';
}

/** Methods the zone offers. A method with no configured fee is not offered. */
export function deliveryOptions(zone: DeliveryZone, now: Date = new Date()): DeliveryOption[] {
  const clock = (() => {
    try {
      return localClock(now, zone.timezone);
    } catch {
      return localClock(now, 'Africa/Lagos');
    }
  })();
  const options: DeliveryOption[] = [];

  const timed = (method: Exclude<DeliveryMethod, 'pickup'>, fee: number | null): DeliveryOption | null => {
    if (fee === null) return null;
    const [from, to] = TRANSIT_DAYS[method];
    return {
      method,
      available: true,
      baseFeeMinor: fee,
      estimate: { earliestDate: addDays(clock.date, from), latestDate: addDays(clock.date, to) },
    };
  };

  const sameDay = timed('same_day', zone.sameDayFeeMinor);
  if (sameDay) {
    const cutoff = cutoffMinutes(zone.sameDayCutoffLocal);
    if (cutoff === 'invalid' || (cutoff !== null && clock.minutes >= cutoff)) {
      sameDay.available = false;
      sameDay.reason = 'CUTOFF_PASSED';
    }
    options.push(sameDay);
  }
  for (const option of [timed('next_day', zone.nextDayFeeMinor), timed('nationwide', zone.nationwideFeeMinor)]) {
    if (option) options.push(option);
  }
  if (zone.pickupEnabled) options.push({ method: 'pickup', available: true, baseFeeMinor: 0, estimate: null });
  return options;
}

export type DeliveryEstimate = { earliestDate: string; latestDate: string };

/**
 * Delivery window for an order that was placed at `placedAt`: the method's transit days counted from the local
 * date it was placed. Pickup has no window.
 */
export function estimateFor(method: string, placedAt: Date, timeZone = 'Africa/Lagos'): DeliveryEstimate | null {
  if (method === 'pickup' || !(method in TRANSIT_DAYS)) return null;
  const [from, to] = TRANSIT_DAYS[method as keyof typeof TRANSIT_DAYS];
  const today = localClock(placedAt, timeZone).date;
  return { earliestDate: addDays(today, from), latestDate: addDays(today, to) };
}
