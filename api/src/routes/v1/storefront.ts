import type { ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { fromJoi, notFound } from '../../lib/errors.js';
import { LIMITS } from '../../lib/rate-policies.js';
import { eventSchema, recordEvents, type IncomingEvent } from '../../modules/analytics/events.js';
import { withUrl } from '../../modules/media/urls.js';
import { getHome, getPage } from '../../modules/content/content.js';
import { listProductReviews, REVIEW_SORTS, submitReview, type ReviewInput, type ReviewSort } from '../../modules/reviews/reviews.js';
import { publicSettings } from '../../modules/settings/settings.js';
import { enforce } from '../../plugins/rate-limit.js';
import { db } from './shared.js';

const shortCache = 'public, max-age=30, stale-while-revalidate=60';
const slug = Joi.string().trim().lowercase().max(160).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const storefrontRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/storefront/home',
    options: { auth: false, description: 'Live homepage content: announcements, banners and the featured row', tags: ['api', 'storefront'] },
    handler: async (request, h) => {
      const home = await getHome(db(request));
      const storage = request.server.app.storage;
      const data = {
        ...home,
        banners: home.banners.map((b) => {
          const key = (b as { imageObjectKey?: string }).imageObjectKey;
          return key ? { ...b, imageUrl: withUrl(storage, { objectKey: key })!.url } : b;
        }),
        featured: { ...home.featured, products: home.featured.products.map((c) => ({ ...c, image: withUrl(storage, c.image) })) },
      };
      return h.response({ data }).header('Cache-Control', shortCache);
    },
  },
  {
    method: 'POST',
    path: '/analytics/events',
    options: {
      auth: { strategy: 'customer', mode: 'try' },
      plugins: { rateLimit: { ip: [LIMITS.events] } },
      description: 'Record storefront funnel events (batch of up to 20)',
      tags: ['api', 'analytics'],
      payload: { maxBytes: 16 * 1024 },
      validate: {
        payload: (value: unknown) => {
          const { value: ok, error } = eventSchema.validate(value, { abortEarly: false, context: { earliest: new Date(Date.now() - 24 * 3600 * 1000) } });
          if (error) throw fromJoi(error);
          return ok;
        },
      },
    },
    handler: async (request, h) => {
      await recordEvents(db(request), (request.payload as { events: IncomingEvent[] }).events, request.auth.credentials?.customerId ?? null);
      return h.response().code(204);
    },
  },
  {
    method: 'GET',
    path: '/storefront/settings',
    options: { auth: false, description: 'Public store details, policies and enabled payment methods', tags: ['api', 'storefront'] },
    handler: async (request, h) => h.response({ data: await publicSettings(db(request)) }).header('Cache-Control', shortCache),
  },
  {
    method: 'GET',
    path: '/content/pages/{slug}',
    options: { auth: false, description: 'Published static page', tags: ['api', 'storefront'], validate: { params: Joi.object({ slug: slug.required() }) } },
    handler: async (request, h) => {
      const page = await getPage(db(request), (request.params as { slug: string }).slug);
      if (!page) throw notFound('Page not found.');
      return h.response({ data: page }).header('Cache-Control', shortCache);
    },
  },
  {
    method: 'GET',
    path: '/products/{productId}/reviews',
    options: {
      auth: false,
      description: 'Approved reviews with rating summary',
      tags: ['api', 'reviews'],
      validate: {
        params: Joi.object({ productId: Joi.string().uuid().required() }),
        query: Joi.object({
          sort: Joi.string().valid(...REVIEW_SORTS).default('newest'),
          rating: Joi.number().integer().min(1).max(5),
          limit: Joi.number().integer().min(1).max(50).default(10),
          cursor: Joi.string().max(512),
        }),
      },
    },
    handler: async (request, h) => {
      const query = request.query as { sort: ReviewSort; rating?: number; limit: number; cursor?: string };
      const body = await listProductReviews(db(request), (request.params as { productId: string }).productId, query);
      return h.response(body).header('Cache-Control', shortCache);
    },
  },
  {
    method: 'POST',
    path: '/reviews',
    options: {
      auth: { strategy: 'customer', mode: 'required' },
      description: 'Submit a verified-purchase review (starts in moderation)',
      tags: ['api', 'reviews'],
      validate: {
        payload: Joi.object({
          orderItemId: Joi.string().uuid().required(),
          rating: Joi.number().integer().min(1).max(5).required(),
          title: Joi.string().trim().min(1).max(120),
          body: Joi.string().trim().min(1).max(3000),
          location: Joi.string().trim().min(1).max(80),
        }),
      },
    },
    handler: async (request, h) => {
      const customerId = request.auth.credentials.customerId!;
      await enforce(request, LIMITS.reviewSubmit, customerId);
      const review = await submitReview(db(request), customerId, request.payload as ReviewInput);
      return h.response(review).code(201).header('Cache-Control', 'no-store');
    },
  },
];
