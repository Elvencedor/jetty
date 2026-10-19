import { asc, eq } from 'drizzle-orm';
import Joi from 'joi';
import type { Db } from '../../db/client.js';
import { deliveryZones } from '../../db/schema/index.js';
import { notFound, unprocessable } from '../../lib/errors.js';

const fee = Joi.number().integer().min(0).max(1_000_000_000).allow(null);

export const zoneSchema = Joi.object({
  id: Joi.string().uuid(),
  name: Joi.string().trim().min(1).max(80),
  state: Joi.string().trim().min(1).max(80),
  areas: Joi.array().items(Joi.string().trim().min(1).max(120)).unique((a, b) => String(a).toLowerCase() === String(b).toLowerCase()).max(200),
  active: Joi.boolean(),
  sameDayCutoffLocal: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).allow(null),
  timezone: Joi.string().max(64).custom((v, helpers) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return v;
    } catch {
      return helpers.error('any.invalid');
    }
  }),
  sameDayFeeMinor: fee,
  nextDayFeeMinor: fee,
  nationwideFeeMinor: fee,
  pickupEnabled: Joi.boolean(),
});

export type ZoneInput = {
  id?: string;
  name?: string;
  state?: string;
  areas?: string[];
  active?: boolean;
  sameDayCutoffLocal?: string | null;
  timezone?: string;
  sameDayFeeMinor?: number | null;
  nextDayFeeMinor?: number | null;
  nationwideFeeMinor?: number | null;
  pickupEnabled?: boolean;
};

export const listZones = (db: Db) => db.select().from(deliveryZones).orderBy(asc(deliveryZones.state), asc(deliveryZones.name));

/**
 * Creates or updates zones in one transaction. Zones are retired with `active:
 * false` rather than deleted, because past orders snapshot the zone by id. A
 * new zone must name itself and its state.
 */
export async function upsertZones(db: Db, zones: ZoneInput[]) {
  return db.transaction(async (tx) => {
    const changes: { before: unknown; after: unknown }[] = [];
    for (const z of zones) {
      const { id, ...fields } = z;
      if (id) {
        const [before] = await tx.select().from(deliveryZones).where(eq(deliveryZones.id, id)).for('update');
        if (!before) throw notFound(`Delivery zone ${id} does not exist.`);
        const [after] = await tx.update(deliveryZones).set({ ...fields, updatedAt: new Date() }).where(eq(deliveryZones.id, id)).returning();
        changes.push({ before, after });
      } else {
        if (!fields.name || !fields.state) throw unprocessable('VALIDATION_FAILED', 'A new zone needs a name and a state.', [{ path: 'zones', code: 'any.required' }]);
        const [after] = await tx.insert(deliveryZones).values({ ...fields, name: fields.name, state: fields.state }).returning();
        changes.push({ before: null, after });
      }
    }
    return changes;
  });
}
