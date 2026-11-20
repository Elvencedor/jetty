import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { deliveryPrepTimes } from '../../db/schema/index.js';
import { addDays, localClock, type DeliveryZone } from './zones.js';

export type PrepTime = typeof deliveryPrepTimes.$inferSelect;
/** Deliveries start on `startsOn` (a local date). `days` is the prep time when it was set in days, null for a fixed date. */
export type DeliveryPrep = { startsOn: string; days: number | null };

/** When a prep time says deliveries start today, or null when it does not apply today. */
export function prepStart(prep: Pick<PrepTime, 'active' | 'mode' | 'days' | 'deliversFrom' | 'activeFrom' | 'activeUntil'>, today: string): DeliveryPrep | null {
  if (!prep.active) return null;
  if (prep.activeFrom && today < prep.activeFrom) return null;
  if (prep.activeUntil && today > prep.activeUntil) return null;
  if (prep.mode === 'date') return prep.deliversFrom && prep.deliversFrom > today ? { startsOn: prep.deliversFrom, days: null } : null;
  return prep.days && prep.days > 0 ? { startsOn: addDays(today, prep.days), days: prep.days } : null;
}

const coversZone = (prep: PrepTime, zoneId: string) => prep.appliesTo === 'all' || (Array.isArray(prep.zoneIds) && (prep.zoneIds as unknown[]).includes(zoneId));

/** The latest start among the prep times that cover a zone and apply today: the longest wait wins. Pure, for tests. */
export function latestPrep(preps: PrepTime[], zoneId: string, today: string): DeliveryPrep | null {
  let best: DeliveryPrep | null = null;
  for (const p of preps) {
    if (!coversZone(p, zoneId)) continue;
    const start = prepStart(p, today);
    if (start && (!best || start.startsOn > best.startsOn)) best = start;
  }
  return best;
}

const todayIn = (now: Date, timeZone: string) => {
  try {
    return localClock(now, timeZone).date;
  } catch {
    return localClock(now, 'Africa/Lagos').date;
  }
};

/** Prep time that holds back deliveries to a zone right now, or null. */
export async function prepForZone(db: Db, now: Date, zone: Pick<DeliveryZone, 'id' | 'timezone'>): Promise<DeliveryPrep | null> {
  const preps = await db.select().from(deliveryPrepTimes).where(eq(deliveryPrepTimes.active, true));
  return latestPrep(preps, zone.id, todayIn(now, zone.timezone));
}

/** The same for several zones at once (a state with area zones, before the area is known). */
export async function prepForZones(db: Db, now: Date, zones: Pick<DeliveryZone, 'id' | 'timezone'>[]): Promise<Map<string, DeliveryPrep | null>> {
  const preps = await db.select().from(deliveryPrepTimes).where(eq(deliveryPrepTimes.active, true));
  return new Map(zones.map((z) => [z.id, latestPrep(preps, z.id, todayIn(now, z.timezone))]));
}
