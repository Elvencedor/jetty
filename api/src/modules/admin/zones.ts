import { asc, eq, sql } from 'drizzle-orm';
import Joi from 'joi';
import type { Db } from '../../db/client.js';
import { deliveryZones } from '../../db/schema/index.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { canonicalState } from '../delivery/states.js';

const fee = Joi.number().integer().min(0).max(1_000_000_000).allow(null);
const days = Joi.number().integer().min(0).max(60);

export const zoneSchema = Joi.object({
  id: Joi.string().uuid(),
  name: Joi.string().trim().min(1).max(80),
  scope: Joi.string().valid('state', 'nationwide'),
  state: Joi.string().trim().min(1).max(80).allow(null),
  states: Joi.array().items(Joi.string().trim().min(1).max(80)).unique((a, b) => String(a).toLowerCase() === String(b).toLowerCase()).max(40),
  areas: Joi.array().items(Joi.string().trim().min(1).max(120)).unique((a, b) => String(a).toLowerCase() === String(b).toLowerCase()).max(200),
  active: Joi.boolean(),
  timezone: Joi.string().max(64).custom((v, helpers) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return v;
    } catch {
      return helpers.error('any.invalid');
    }
  }),
  deliveryFeeMinor: fee,
  deliveryMinDays: days,
  deliveryMaxDays: days,
  pickupEnabled: Joi.boolean(),
});

export type ZoneInput = {
  id?: string;
  name?: string;
  scope?: 'state' | 'nationwide';
  state?: string | null;
  states?: string[];
  areas?: string[];
  active?: boolean;
  timezone?: string;
  deliveryFeeMinor?: number | null;
  deliveryMinDays?: number;
  deliveryMaxDays?: number;
  pickupEnabled?: boolean;
};


/** The longest delivery time cannot be shorter than the shortest. */
function requireDurationOrder(min: number, max: number) {
  if (max < min) throw unprocessable('VALIDATION_FAILED', 'The longest delivery time cannot be shorter than the shortest.', [{ path: 'deliveryMaxDays', code: 'number.min' }]);
}

type Coverage = { scope: 'state' | 'nationwide'; state: string | null; states: string[]; areas: string[] };

/**
 * What a zone covers once an edit is applied. A state zone names one state (areas optional); a nationwide zone lists the
 * states it reaches and has no areas. Names are saved as the canonical state spelling so they match what checkout sends.
 */
function coverageOf(before: typeof deliveryZones.$inferSelect | undefined, fields: ZoneInput): Coverage {
  const scope: Coverage['scope'] = fields.scope ?? (before?.scope === 'nationwide' ? 'nationwide' : 'state');
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const bad = (path: string, message: string) => unprocessable('VALIDATION_FAILED', message, [{ path, code: 'any.invalid' }]);

  if (scope === 'state') {
    const name = fields.state !== undefined ? fields.state : before?.scope === 'state' ? before.state : null;
    if (!name) throw bad('state', 'A state zone needs a state.');
    const state = canonicalState(name);
    if (!state) throw bad('state', `"${name}" is not a Nigerian state.`);
    return { scope, state, states: [], areas: fields.areas ?? (before?.scope === 'state' ? strings(before.areas) : []) };
  }

  const listed = fields.states ?? (before?.scope === 'nationwide' ? strings(before.states) : []);
  if (listed.length === 0) throw bad('states', 'A nationwide zone needs at least one state.');
  const states = listed.map((n) => canonicalState(n) ?? null);
  const unknown = listed.filter((_, i) => states[i] === null);
  if (unknown.length) throw bad('states', `Not Nigerian states: ${unknown.join(', ')}.`);
  return { scope, state: null, states: [...new Set(states as string[])], areas: [] };
}

/** A state belongs to one live nationwide zone at a time, or the price for it would be ambiguous. */
async function requireNoOverlap(tx: Pick<Db, 'select'>, coverage: Coverage, active: boolean, id: string | undefined) {
  if (coverage.scope !== 'nationwide' || !active) return;
  const others = await tx.select().from(deliveryZones).where(eq(deliveryZones.scope, 'nationwide'));
  for (const other of others) {
    if (other.id === id || !other.active) continue;
    const shared = coverage.states.filter((s) => (Array.isArray(other.states) ? (other.states as unknown[]) : []).includes(s));
    if (shared.length) throw unprocessable('VALIDATION_FAILED', `${shared.join(', ')} already belong to the nationwide zone "${other.name}".`, [{ path: 'states', code: 'any.invalid' }]);
  }
}

export const listZones = (db: Db) => db.select().from(deliveryZones).orderBy(asc(deliveryZones.scope), asc(deliveryZones.state), asc(deliveryZones.name));

/**
 * Creates or updates zones in one transaction. Zones are retired with `active:
 * false` rather than deleted, because past orders snapshot the zone by id. A
 * new zone must name itself and say what it covers.
 */
export async function upsertZones(db: Db, zones: ZoneInput[]) {
  return db.transaction(async (tx) => {
    const changes: { before: unknown; after: unknown }[] = [];
    for (const z of zones) {
      const { id, ...fields } = z;
      if (id) {
        const [before] = await tx.select().from(deliveryZones).where(eq(deliveryZones.id, id)).for('update');
        if (!before) throw notFound(`Delivery zone ${id} does not exist.`);
        requireDurationOrder(fields.deliveryMinDays ?? before.deliveryMinDays, fields.deliveryMaxDays ?? before.deliveryMaxDays);
        const coverage = coverageOf(before, fields);
        await requireNoOverlap(tx, coverage, fields.active ?? before.active, id);
        const [after] = await tx.update(deliveryZones).set({ ...fields, ...coverage, updatedAt: new Date() }).where(eq(deliveryZones.id, id)).returning();
        changes.push({ before, after });
      } else {
        requireDurationOrder(fields.deliveryMinDays ?? 1, fields.deliveryMaxDays ?? 3);
        if (!fields.name) throw unprocessable('VALIDATION_FAILED', 'A new zone needs a name.', [{ path: 'zones', code: 'any.required' }]);
        const coverage = coverageOf(undefined, fields);
        await requireNoOverlap(tx, coverage, fields.active ?? true, undefined);
        const [after] = await tx.insert(deliveryZones).values({ ...fields, ...coverage, name: fields.name }).returning();
        changes.push({ before: null, after });
      }
    }
    return changes;
  });
}

/**
 * Deletes a zone for good. Past orders keep their zone name in their own address snapshot and nothing else reads a zone by
 * id, so they are untouched. A free-delivery promotion that is limited to this zone would be left pointing at nothing (and so
 * would never apply), which is refused: take the zone out of those promotions first.
 */
export async function deleteZone(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(deliveryZones).where(eq(deliveryZones.id, id)).for('update');
    if (!before) throw notFound(`Delivery zone ${id} does not exist.`);
    const using = (await tx.execute(sql`
      select p.name from promotions p
      where p.kind = 'free_delivery' and p.status <> 'expired' and (p.ends_at is null or p.ends_at > now())
        and p.configuration->'zoneIds' @> ${JSON.stringify([id])}::jsonb
      order by p.name`)) as unknown as { name: string }[];
    if (using.length) {
      const names = using.map((p) => `"${p.name}"`).join(', ');
      throw conflict('ZONE_IN_USE', `Free delivery promotions still use this zone: ${names}. Take it out of ${using.length === 1 ? 'that promotion' : 'those promotions'} first, or switch the zone off instead.`);
    }
    await tx.delete(deliveryZones).where(eq(deliveryZones.id, id));
    return before;
  });
}
