import { asc, eq, inArray, sql } from 'drizzle-orm';
import Joi from 'joi';
import type { Db } from '../../db/client.js';
import { deliveryPrepTimes, deliveryZones } from '../../db/schema/index.js';
import { notFound, unprocessable } from '../../lib/errors.js';

const day = Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, '').messages({ 'string.pattern.base': 'must be a date like 2026-12-01' });

export const prepTimeSchema = Joi.object({
  name: Joi.string().trim().min(1).max(80),
  active: Joi.boolean(),
  mode: Joi.string().valid('days', 'date'),
  days: Joi.number().integer().min(1).max(365).allow(null),
  deliversFrom: day,
  activeFrom: day,
  activeUntil: day,
  appliesTo: Joi.string().valid('all', 'zones'),
  zoneIds: Joi.array().items(Joi.string().uuid()).unique().max(200),
});

export type PrepTimeInput = {
  name?: string;
  active?: boolean;
  mode?: 'days' | 'date';
  days?: number | null;
  deliversFrom?: string | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
  appliesTo?: 'all' | 'zones';
  zoneIds?: string[];
};

type Row = typeof deliveryPrepTimes.$inferSelect;
const bad = (path: string, message: string) => unprocessable('VALIDATION_FAILED', message, [{ path, code: 'any.invalid' }]);
const blank = (v: string | null | undefined) => (v === '' || v === undefined ? null : v);

export const listPrepTimes = (db: Db) => db.select().from(deliveryPrepTimes).orderBy(asc(deliveryPrepTimes.name), asc(deliveryPrepTimes.id));

/** The prep time as it will be saved, checked as a whole (an edit is merged over what is stored). */
async function resolve(tx: Pick<Db, 'select'>, before: Row | undefined, fields: PrepTimeInput) {
  const merged = {
    name: fields.name ?? before?.name,
    active: fields.active ?? before?.active ?? true,
    mode: fields.mode ?? (before?.mode as 'days' | 'date' | undefined) ?? 'days',
    days: fields.days !== undefined ? fields.days : (before?.days ?? null),
    deliversFrom: blank(fields.deliversFrom !== undefined ? fields.deliversFrom : before?.deliversFrom),
    activeFrom: blank(fields.activeFrom !== undefined ? fields.activeFrom : before?.activeFrom),
    activeUntil: blank(fields.activeUntil !== undefined ? fields.activeUntil : before?.activeUntil),
    appliesTo: fields.appliesTo ?? (before?.appliesTo as 'all' | 'zones' | undefined) ?? 'all',
    zoneIds: fields.zoneIds ?? (Array.isArray(before?.zoneIds) ? (before!.zoneIds as string[]) : []),
  };
  if (!merged.name) throw bad('name', 'A prep time needs a name.');
  if (merged.mode === 'days' && !merged.days) throw bad('days', 'Enter how many days preparation takes.');
  if (merged.mode === 'date' && !merged.deliversFrom) throw bad('deliversFrom', 'Choose the day deliveries start.');
  if (merged.activeFrom && merged.activeUntil && merged.activeUntil < merged.activeFrom) throw bad('activeUntil', 'The end cannot be before the start.');
  if (merged.appliesTo === 'all') merged.zoneIds = [];
  else {
    if (merged.zoneIds.length === 0) throw bad('zoneIds', 'Choose at least one zone.');
    const found = await tx.select({ id: deliveryZones.id }).from(deliveryZones).where(inArray(deliveryZones.id, merged.zoneIds));
    if (found.length !== merged.zoneIds.length) throw bad('zoneIds', 'One of those zones does not exist.');
  }
  // Only the field for the chosen mode is kept, so the other cannot linger and confuse a later edit.
  return { ...merged, name: merged.name, days: merged.mode === 'days' ? merged.days : null, deliversFrom: merged.mode === 'date' ? merged.deliversFrom : null };
}

export async function createPrepTime(db: Db, fields: PrepTimeInput) {
  return db.transaction(async (tx) => {
    const values = await resolve(tx, undefined, fields);
    const [after] = await tx.insert(deliveryPrepTimes).values(values).returning();
    return { before: null, after: after! };
  });
}

export async function updatePrepTime(db: Db, id: string, fields: PrepTimeInput) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(deliveryPrepTimes).where(eq(deliveryPrepTimes.id, id)).for('update');
    if (!before) throw notFound(`Prep time ${id} does not exist.`);
    const values = await resolve(tx, before, fields);
    const [after] = await tx.update(deliveryPrepTimes).set({ ...values, updatedAt: new Date() }).where(eq(deliveryPrepTimes.id, id)).returning();
    return { before, after: after! };
  });
}

/** Orders keep the start day they were promised in their own snapshot, so a prep time can be deleted freely. */
export async function deletePrepTime(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(deliveryPrepTimes).where(eq(deliveryPrepTimes.id, id)).for('update');
    if (!before) throw notFound(`Prep time ${id} does not exist.`);
    await tx.delete(deliveryPrepTimes).where(eq(deliveryPrepTimes.id, id));
    return before;
  });
}

/** Takes a deleted zone out of every prep time that named it. */
export const forgetZone = (tx: Pick<Db, 'execute'>, zoneId: string) =>
  tx.execute(sql`update delivery_prep_times set zone_ids = zone_ids - ${zoneId}::text, updated_at = now() where zone_ids @> ${JSON.stringify([zoneId])}::jsonb`);
