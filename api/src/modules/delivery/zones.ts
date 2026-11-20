import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { deliveryZones } from '../../db/schema/index.js';
import type { DeliveryPrep } from './prep.js';

/** `delivery` is the one priced option (a zone's fee and duration); `pickup` is collection from the showroom. */
export const DELIVERY_METHODS = ['delivery', 'pickup'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** The window as admin set it (`minDays` to `maxDays`), plus the dates it works out to. The storefront shows the days. */
export type DeliveryEstimate = {
  earliestDate: string;
  latestDate: string;
  minDays: number;
  maxDays: number;
  /** The day the days are counted from when a prep period holds deliveries back; null when they count from the order. */
  startsOn: string | null;
};

export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type Destination = { state: string; area?: string | undefined };

export type DeliveryOption = {
  method: DeliveryMethod;
  available: boolean;
  /** Admin-configured fee for the zone, in minor units. */
  baseFeeMinor: number;
  /** Local-date window (YYYY-MM-DD in the zone's timezone); null when no date applies (pickup). */
  estimate: DeliveryEstimate | null;
};

// Orders placed before delivery had one price carry the method they were sold under. Their windows stay as they were.
const LEGACY_TRANSIT_DAYS: Record<string, [number, number]> = { same_day: [0, 0], next_day: [1, 1], nationwide: [2, 4] };

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const statesOf = (z: DeliveryZone) => (Array.isArray(z.states) ? z.states.filter((s): s is string => typeof s === 'string').map(normalise) : []);

/**
 * Resolves the zone for a destination from admin-managed configuration, most specific first:
 * 1. a state zone that lists the destination area;
 * 2. the state-wide zone for the destination state (empty `areas`);
 * 3. the nationwide zone whose `states` include the destination state, when the state has no zones of its own or the
 *    destination area is none that its zones list.
 * A state with its own zones but no state-wide one needs an area: with none given there is no zone (the area is
 * required), and an area they do not list is priced by the nationwide zone if it covers the state.
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
  // A state with its own zones needs an area. Without one there is no zone; with an area none of them lists, the
  // nationwide zone is the fallback.
  if (stateZones.length > 0 && !area) return undefined;

  const nationwide = await db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.active, true), eq(deliveryZones.scope, 'nationwide')))
    .orderBy(asc(deliveryZones.name), asc(deliveryZones.id));
  return nationwide.find((z) => statesOf(z).includes(state));
}

/**
 * Active state zones for a state that carry a delivery price, cheapest first. Used when the destination did not pick
 * out one of them (no area, or an area none lists) and the state has no state-wide or nationwide zone to fall back on,
 * so the storefront can show the range and let the customer choose an area.
 */
export async function stateZonesFor(db: Db, stateName: string): Promise<DeliveryZone[]> {
  const state = normalise(stateName);
  const zones = await db
    .select()
    .from(deliveryZones)
    .where(and(eq(deliveryZones.active, true), eq(deliveryZones.scope, 'state'), sql`lower(btrim(${deliveryZones.state})) = ${state}`))
    .orderBy(asc(deliveryZones.name), asc(deliveryZones.id));
  return zones.filter((z) => z.deliveryFeeMinor !== null).sort((a, b) => Number(a.deliveryFeeMinor) - Number(b.deliveryFeeMinor) || a.name.localeCompare(b.name));
}

export function localClock(now: Date, timeZone: string) {
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

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function windowFrom(base: string, minDays: number, maxDays: number, startsOn: string | null): DeliveryEstimate {
  return { earliestDate: addDays(base, minDays), latestDate: addDays(base, maxDays), minDays, maxDays, startsOn };
}

/** Methods the zone offers. A zone with no delivery price is pickup only. */
export function deliveryOptions(zone: DeliveryZone, now: Date = new Date(), prep: DeliveryPrep | null = null): DeliveryOption[] {
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
      estimate: windowFrom(prep && prep.startsOn > clock.date ? prep.startsOn : clock.date, zone.deliveryMinDays, zone.deliveryMaxDays, prep && prep.startsOn > clock.date ? prep.startsOn : null),
    });
  }
  if (zone.pickupEnabled) options.push({ method: 'pickup', available: true, baseFeeMinor: 0, estimate: null });
  return options;
}


/** The delivery days saved in an order's address snapshot when it was placed; empty for orders from before they were kept. */
export function promisedDays(snapshot: unknown): { minDays?: number; maxDays?: number; startsOn?: string } {
  const s = (snapshot ?? {}) as { deliveryMinDays?: unknown; deliveryMaxDays?: unknown; deliveryStartsOn?: unknown };
  return {
    ...(typeof s.deliveryStartsOn === 'string' ? { startsOn: s.deliveryStartsOn } : {}),
    ...(typeof s.deliveryMinDays === 'number' ? { minDays: s.deliveryMinDays } : {}),
    ...(typeof s.deliveryMaxDays === 'number' ? { maxDays: s.deliveryMaxDays } : {}),
  };
}

/**
 * Delivery window for an order that was placed at `placedAt`: the days the zone promised when the order was placed,
 * counted from the local date it was placed. Pickup has no window. Orders from before delivery had one price carry
 * their old method and use its old window.
 */
export function estimateFor(method: string, placedAt: Date, promised?: { minDays?: number; maxDays?: number; startsOn?: string }, timeZone = 'Africa/Lagos'): DeliveryEstimate | null {
  if (method === 'pickup') return null;
  const legacy = LEGACY_TRANSIT_DAYS[method];
  const from = legacy ? legacy[0] : promised?.minDays;
  const to = legacy ? legacy[1] : promised?.maxDays;
  if (from === undefined || to === undefined) return null;
  const placed = localClock(placedAt, timeZone).date;
  // An order placed during a prep period counts its days from the day deliveries start.
  const held = !legacy && promised?.startsOn !== undefined && promised.startsOn > placed;
  return windowFrom(held ? promised.startsOn! : placed, from, to, held ? promised.startsOn! : null);
}
