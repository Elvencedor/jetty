import type { ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { actionCounts, dashboard, INTERVALS, periods, productAnalytics, revenueSeries, type Interval } from '../../../modules/admin/analytics.js';
import { withUrl } from '../../../modules/media/urls.js';
import { db, guard, NO_STORE } from './shared.js';

const range = { from: Joi.date().iso(), to: Joi.date().iso() };

export const adminAnalyticsRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/admin/dashboard',
    options: { ...guard('analytics:read'), description: 'KPIs with previous-period comparison, top products, category sales and action counts', tags: ['api', 'admin'], validate: { query: Joi.object(range) } },
    handler: async (request, h) => {
      const { from, to } = request.query as { from?: Date; to?: Date };
      const data = await dashboard(db(request), periods(from, to));
      return h.response({ ...data, topProducts: data.topProducts.map((t) => ({ ...t, image: withUrl(request.server.app.storage, t.image) })) }).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/admin/analytics/revenue',
    options: { ...guard('analytics:read'), description: 'Revenue series with the previous period', tags: ['api', 'admin'], validate: { query: Joi.object({ ...range, interval: Joi.string().valid(...INTERVALS).default('day') }) } },
    handler: async (request, h) => {
      const { from, to, interval } = request.query as { from?: Date; to?: Date; interval: Interval };
      return h.response(await revenueSeries(db(request), periods(from, to), interval)).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/admin/analytics/products',
    options: { ...guard('analytics:read'), description: 'Top products and sales by category', tags: ['api', 'admin'], validate: { query: Joi.object(range) } },
    handler: async (request, h) => {
      const { from, to } = request.query as { from?: Date; to?: Date };
      const data = await productAnalytics(db(request), periods(from, to));
      return h.response({ ...data, topProducts: data.topProducts.map((t) => ({ ...t, image: withUrl(request.server.app.storage, t.image) })) }).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/admin/orders-to-action',
    options: { ...guard('orders:read'), description: 'Counts of orders awaiting an action (pack, dispatch, transfer, exception)', tags: ['api', 'admin'] },
    handler: async (request, h) => h.response(await actionCounts(db(request))).header('Cache-Control', NO_STORE),
  },
];
