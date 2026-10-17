import { LIMITS } from '../../lib/rate-policies.js';
import type { Request, ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import type { Db } from '../../db/client.js';
import { apiError } from '../../lib/errors.js';
import { DELIVERY_METHODS, type DeliveryMethod } from '../../modules/delivery/zones.js';
import { deliveryQuote, quote } from '../../modules/pricing/quote.js';

const items = Joi.array()
  .items(
    Joi.object({
      variantId: Joi.string().uuid().required(),
      quantity: Joi.number().integer().min(1).max(99).required(),
    }),
  )
  .min(1)
  .max(50)
  .required();

const promotionCodes = Joi.array().items(Joi.string().trim().min(1).max(64)).max(5).default([]);

// Only the fields needed to resolve a zone; the full address is validated at checkout.
const deliveryAddress = Joi.object({
  state: Joi.string().trim().min(1).max(80).required(),
  area: Joi.string().trim().min(1).max(120),
  city: Joi.string().trim().max(120),
  countryCode: Joi.string().uppercase().valid('NG').default('NG'),
});

type Body = {
  items: { variantId: string; quantity: number }[];
  promotionCodes: string[];
  deliveryAddress?: { state: string; area?: string };
  deliveryMethod?: DeliveryMethod;
};

function db(request: Request): Db {
  const database = request.server.app.database;
  if (!database) throw apiError(503, 'DATABASE_UNAVAILABLE', 'The service is temporarily unavailable.');
  return database.db;
}

// Quotes depend on live stock and promotions; never let shared caches store them.
const NO_STORE = 'no-store';

export const pricingRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/pricing/quote',
    options: {
      auth: false,
      plugins: { rateLimit: { ip: [LIMITS.quote] } },
      description: 'Stateless server-calculated quote for submitted variants, promotion codes and delivery',
      tags: ['api', 'pricing'],
      validate: {
        payload: Joi.object({
          items,
          promotionCodes,
          deliveryAddress,
          deliveryMethod: Joi.string().valid(...DELIVERY_METHODS),
        }).and('deliveryAddress', 'deliveryMethod'),
      },
    },
    handler: async (request, h) => {
      const body = request.payload as Body;
      const result = await quote(db(request), {
        items: body.items,
        promotionCodes: body.promotionCodes,
        ...(body.deliveryAddress ? { deliveryAddress: body.deliveryAddress } : {}),
        ...(body.deliveryMethod ? { deliveryMethod: body.deliveryMethod } : {}),
      });
      return h.response(result).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'POST',
    path: '/delivery/quotes',
    options: {
      auth: false,
      plugins: { rateLimit: { ip: [LIMITS.quote] } },
      description: 'Delivery zone, methods, fees, ETAs and same-day eligibility for a destination and cart',
      tags: ['api', 'delivery'],
      validate: { payload: Joi.object({ items, promotionCodes, deliveryAddress: deliveryAddress.required() }) },
    },
    handler: async (request, h) => {
      const body = request.payload as Body & { deliveryAddress: { state: string; area?: string } };
      const result = await deliveryQuote(db(request), {
        items: body.items,
        promotionCodes: body.promotionCodes,
        deliveryAddress: body.deliveryAddress,
      });
      return h.response(result).header('Cache-Control', NO_STORE);
    },
  },
];
