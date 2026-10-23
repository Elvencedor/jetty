import type { ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { createContent, getContent, listContent, updateContent, type ContentInput } from '../../../modules/admin/content.js';
import { customerSegments, getAdminCustomer, listAdminCustomers, SEGMENTS, listAdminReviews, moderateReview, reviewSummary } from '../../../modules/admin/people.js';
import { listZones, upsertZones, zoneSchema, type ZoneInput } from '../../../modules/admin/zones.js';
import { CONTENT_STATUSES, CONTENT_TYPES } from '../../../modules/content/content.js';
import { getSetting, isSettingKey, SETTING_KEYS, SETTINGS, updateSetting } from '../../../modules/settings/settings.js';
import { withUrl } from '../../../modules/media/urls.js';
import { revalidateStorefront } from '../../../lib/revalidate.js';
import { fromJoi, notFound } from '../../../lib/errors.js';
import { audited, db, guard, NO_STORE, pageQuery, slugSchema, uuidParam } from './shared.js';

const contentFields = {
  title: Joi.string().trim().min(1).max(200),
  slug: slugSchema,
  body: Joi.object().unknown(true),
  status: Joi.string().valid(...CONTENT_STATUSES),
  startsAt: Joi.date().iso().allow(null),
  endsAt: Joi.date().iso().allow(null),
  sortOrder: Joi.number().integer().min(0).max(10_000),
};

export const adminManagementRoutes: ServerRoute[] = [
  // ------------------------------------------------------------------ content
  {
    method: 'GET',
    path: '/admin/content',
    options: {
      ...guard('content:read'),
      description: 'List banners, announcements, featured rows and static pages',
      tags: ['api', 'admin'],
      validate: { query: Joi.object({ ...pageQuery, type: Joi.string().valid(...CONTENT_TYPES), status: Joi.string().valid(...CONTENT_STATUSES), q: Joi.string().trim().min(1).max(100) }) },
    },
    handler: async (request, h) => h.response(await listContent(db(request), request.query as never)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'GET',
    path: '/admin/content/{id}',
    options: { ...guard('content:read'), description: 'One content entry', tags: ['api', 'admin'], validate: { params: uuidParam('id') } },
    handler: async (request, h) => h.response(await getContent(db(request), (request.params as { id: string }).id)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'POST',
    path: '/admin/content',
    options: {
      ...guard('content:write'),
      description: 'Create a content entry (draft unless published); the body is validated per type',
      tags: ['api', 'admin'],
      validate: { payload: Joi.object({ ...contentFields, contentType: Joi.string().valid(...CONTENT_TYPES).required(), title: contentFields.title.required(), body: contentFields.body.required() }) },
    },
    handler: async (request, h) => {
      const row = await audited(request, (tx) => createContent(tx, request.auth.credentials.adminId!, request.payload as ContentInput), (row) => ({ action: 'content.create', resourceType: 'content', resourceId: row.id, after: { contentType: row.contentType, slug: row.slug, status: row.status } }));
      void revalidateStorefront(request.server.app.env, request.server.app.logger, ['home']);
      return h.response(row).code(201).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'PATCH',
    path: '/admin/content/{id}',
    options: { ...guard('content:write'), description: 'Edit, schedule, publish or archive a content entry', tags: ['api', 'admin'], validate: { params: uuidParam('id'), payload: Joi.object(contentFields).min(1) } },
    handler: async (request, h) => {
      const { id } = request.params as { id: string };
      const { after } = await audited(request, (tx) => updateContent(tx, id, request.payload as Partial<ContentInput>), ({ before, after }) => ({ action: 'content.update', resourceType: 'content', resourceId: id, before: { title: before.title, status: before.status, startsAt: before.startsAt, endsAt: before.endsAt, body: before.body }, after: { title: after.title, status: after.status, startsAt: after.startsAt, endsAt: after.endsAt, body: after.body } }));
      void revalidateStorefront(request.server.app.env, request.server.app.logger, ['home']);
      return h.response(after).header('Cache-Control', NO_STORE);
    },
  },

  // ---------------------------------------------------------------- customers
  {
    method: 'GET',
    path: '/admin/customers',
    options: {
      ...guard('customers:read'),
      description: 'Search customers with order count and lifetime value',
      tags: ['api', 'admin'],
      validate: { query: Joi.object({ ...pageQuery, q: Joi.string().trim().min(2).max(100), segment: Joi.string().valid(...SEGMENTS.map((g) => g.key)), sort: Joi.string().valid('newest', 'spend').default('newest') }) },
    },
    handler: async (request, h) => h.response(await listAdminCustomers(db(request), request.query as never)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'GET',
    path: '/admin/customers/segments',
    options: { ...guard('customers:read'), description: 'Customer segment sizes and the rule behind each', tags: ['api', 'admin'] },
    handler: async (request, h) => h.response(await customerSegments(db(request))).header('Cache-Control', NO_STORE),
  },
  {
    method: 'GET',
    path: '/admin/customers/{id}',
    options: { ...guard('customers:read'), description: 'Customer profile with recent orders', tags: ['api', 'admin'], validate: { params: uuidParam('id') } },
    handler: async (request, h) => h.response(await getAdminCustomer(db(request), (request.params as { id: string }).id)).header('Cache-Control', NO_STORE),
  },

  // ------------------------------------------------------------------ reviews
  {
    method: 'GET',
    path: '/admin/reviews',
    options: {
      ...guard('reviews:moderate'),
      description: 'Review moderation queue',
      tags: ['api', 'admin'],
      validate: { query: Joi.object({ ...pageQuery, status: Joi.string().valid('pending', 'approved', 'rejected', 'hidden'), productId: Joi.string().uuid() }) },
    },
    handler: async (request, h) => {
      const page = await listAdminReviews(db(request), request.query as never);
      const storage = request.server.app.storage;
      return h.response({ ...page, data: page.data.map((r) => ({ ...r, image: withUrl(storage, r.image) })) }).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/admin/reviews/summary',
    options: { ...guard('reviews:moderate'), description: 'The store rating from published reviews', tags: ['api', 'admin'] },
    handler: async (request, h) => h.response(await reviewSummary(db(request))).header('Cache-Control', NO_STORE),
  },
  {
    method: 'PATCH',
    path: '/admin/reviews/{id}',
    options: {
      ...guard('reviews:moderate'),
      description: 'Approve, reject or hide a review',
      tags: ['api', 'admin'],
      validate: { params: uuidParam('id'), payload: Joi.object({ status: Joi.string().valid('approved', 'rejected', 'hidden').required() }) },
    },
    handler: async (request, h) => {
      const { id } = request.params as { id: string };
      const { after } = await audited(request, (tx) => moderateReview(tx, id, (request.payload as { status: 'approved' | 'rejected' | 'hidden' }).status), ({ before, after }) => ({ action: 'review.moderate', resourceType: 'review', resourceId: id, before: { status: before }, after: { status: after.status } }));
      return h.response(after).header('Cache-Control', NO_STORE);
    },
  },

  // ----------------------------------------------------------------- settings
  {
    method: 'GET',
    path: '/admin/settings/{key}',
    options: {
      ...guard('settings:read'),
      description: `Read an allow-listed setting (${[...SETTING_KEYS, 'delivery-zones'].join(', ')})`,
      tags: ['api', 'admin'],
      validate: { params: Joi.object({ key: Joi.string().valid(...SETTING_KEYS, 'delivery-zones').required() }) },
    },
    handler: async (request, h) => {
      const { key } = request.params as { key: string };
      if (key === 'delivery-zones') return h.response({ zones: await listZones(db(request)) }).header('Cache-Control', NO_STORE);
      if (!isSettingKey(key)) throw notFound('Unknown setting.');
      return h.response(await getSetting(db(request), key)).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'PATCH',
    path: '/admin/settings/{key}',
    options: {
      ...guard('settings:write'),
      description: 'Update fields of an allow-listed setting; delivery-zones takes { zones: [...] }',
      tags: ['api', 'admin'],
      validate: { params: Joi.object({ key: Joi.string().valid(...SETTING_KEYS, 'delivery-zones').required() }), payload: Joi.object().min(1).unknown(true) },
    },
    handler: async (request, h) => {
      const { key } = request.params as { key: string };
      if (key === 'delivery-zones') {
        const { value, error } = Joi.object({ zones: Joi.array().items(zoneSchema).min(1).max(100).required() }).validate(request.payload, { abortEarly: false });
        if (error) throw fromJoi(error);
        await audited(request, (tx) => upsertZones(tx, (value as { zones: ZoneInput[] }).zones), (changes) => ({ action: 'settings.delivery_zones', resourceType: 'settings', resourceId: key, before: changes.map((c) => c.before), after: changes.map((c) => c.after) }));
        void revalidateStorefront(request.server.app.env, request.server.app.logger, ['settings']);
        return h.response({ zones: await listZones(db(request)) }).header('Cache-Control', NO_STORE);
      }
      if (!isSettingKey(key)) throw notFound('Unknown setting.');
      const { value, error } = SETTINGS[key].schema.validate(request.payload, { abortEarly: false });
      if (error) throw fromJoi(error);
      const { after } = await audited(request, (tx) => updateSetting(tx, request.auth.credentials.adminId!, key, value as Record<string, unknown>), ({ before, after }) => ({ action: `settings.${key}`, resourceType: 'settings', resourceId: key, before, after }));
      void revalidateStorefront(request.server.app.env, request.server.app.logger, ['settings']);
      return h.response(after).header('Cache-Control', NO_STORE);
    },
  },
];
