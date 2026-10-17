import type { Request, ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import type { Db } from '../../db/client.js';
import { apiError } from '../../lib/errors.js';
import { LIMITS } from '../../lib/rate-policies.js';
import { getCustomerOrder, listCustomerOrders, trackOrder } from '../../modules/orders/history.js';
import { enforce } from '../../plugins/rate-limit.js';

const NO_STORE = 'no-store';

function db(request: Request): Db {
  const database = request.server.app.database;
  if (!database) throw apiError(503, 'DATABASE_UNAVAILABLE', 'The service is temporarily unavailable.');
  return database.db;
}

const customerId = (request: Request) => request.auth.credentials.customerId!;

export const orderRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/me/orders',
    options: {
      auth: { strategy: 'customer', mode: 'required' },
      description: 'Authenticated order history, newest first',
      tags: ['api', 'me'],
      validate: {
        query: Joi.object({ limit: Joi.number().integer().min(1).max(50).default(20), cursor: Joi.string().max(512) }),
      },
    },
    handler: async (request, h) =>
      h.response(await listCustomerOrders(db(request), customerId(request), request.query as { limit: number; cursor?: string })).header('Cache-Control', NO_STORE),
  },
  {
    method: 'GET',
    path: '/me/orders/{orderId}',
    options: {
      auth: { strategy: 'customer', mode: 'required' },
      description: 'Own order detail and status timeline',
      tags: ['api', 'me'],
      validate: { params: Joi.object({ orderId: Joi.string().uuid().required() }) },
    },
    handler: async (request, h) =>
      h.response(await getCustomerOrder(db(request), customerId(request), (request.params as { orderId: string }).orderId)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'POST',
    path: '/orders/track',
    options: {
      auth: false,
      plugins: { rateLimit: { ip: [LIMITS.track] } },
      description: 'Guest lookup by order number plus phone; minimal timeline only',
      tags: ['api', 'orders'],
      validate: {
        payload: Joi.object({
          orderNumber: Joi.string().trim().min(6).max(32).required(),
          phone: Joi.string().trim().pattern(/^\+[1-9]\d{7,14}$/).required().messages({ 'string.pattern.base': 'phone must be in E.164 format, e.g. +2348012345678' }),
        }),
      },
    },
    handler: async (request, h) => {
      const body = request.payload as { orderNumber: string; phone: string };
      // Caps guesses at one order's phone number from any number of IPs.
      await enforce(request, LIMITS.trackOrder, body.orderNumber);
      return h.response(await trackOrder(db(request), body)).header('Cache-Control', NO_STORE);
    },
  },
];
