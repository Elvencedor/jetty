import Joi from 'joi';
import type { Db } from '../../db/client.js';
import { analyticsEvents } from '../../db/schema/index.js';

/** Storefront events only. `purchase` is deliberately absent: sales come from paid orders, never from the browser. */
export const EVENT_NAMES = ['session_start', 'product_view', 'add_to_bag', 'checkout_start'] as const;

export const eventSchema = Joi.object({
  events: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().valid(...EVENT_NAMES).required(),
        anonymousId: Joi.string().trim().min(8).max(64).pattern(/^[\w-]+$/).required(),
        sessionId: Joi.string().trim().min(8).max(64).pattern(/^[\w-]+$/).required(),
        occurredAt: Joi.date().iso().max('now').min(Joi.ref('$earliest')),
        // A fixed, small set of keys keeps this table from becoming a dumping ground for arbitrary client data.
        properties: Joi.object({ productId: Joi.string().uuid(), variantId: Joi.string().uuid(), quantity: Joi.number().integer().min(1).max(99), source: Joi.string().max(40) }).default({}),
      }),
    )
    .min(1)
    .max(20)
    .required(),
});

export type IncomingEvent = { name: (typeof EVENT_NAMES)[number]; anonymousId: string; sessionId: string; occurredAt?: Date; properties: Record<string, unknown> };

export async function recordEvents(db: Db, events: IncomingEvent[], customerId: string | null) {
  await db.insert(analyticsEvents).values(
    events.map((e) => ({ customerId, anonymousId: e.anonymousId, sessionId: e.sessionId, eventName: e.name, properties: e.properties, ...(e.occurredAt ? { occurredAt: e.occurredAt } : {}) })),
  );
}
