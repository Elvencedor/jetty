import type { ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { CODE_PATTERN, createPromotion, getAdminPromotion, listAdminPromotions, setPromotionState, SUPPORTED_KINDS, updatePromotion, type PromotionInput, type PromotionPatch } from '../../../modules/admin/promotions.js';
import { audited, db, guard, NO_STORE, pageQuery, uuidParam } from './shared.js';

const write = guard('promotions:write');
const read = guard('promotions:read');

const money = Joi.number().integer().min(0).max(1_000_000_000_000);
const codes = Joi.array()
  .items(
    Joi.object({
      code: Joi.string().trim().pattern(CODE_PATTERN).required().messages({ 'string.pattern.base': 'codes are 3-32 letters, digits, dashes or underscores' }),
      maxRedemptions: Joi.number().integer().min(1).allow(null),
      active: Joi.boolean(),
    }),
  )
  .max(50);

const fields = {
  name: Joi.string().trim().min(1).max(120),
  kind: Joi.string().valid(...SUPPORTED_KINDS),
  configuration: Joi.object().unknown(true),
  scope: Joi.object().unknown(true),
  startsAt: Joi.date().iso().allow(null),
  endsAt: Joi.date().iso().allow(null),
  priority: Joi.number().integer().min(-1000).max(1000),
  stackable: Joi.boolean(),
  totalUsageLimit: Joi.number().integer().min(1).allow(null),
  perCustomerLimit: Joi.number().integer().min(1).allow(null),
  firstOrderOnly: Joi.boolean(),
  minimumSubtotalMinor: money.allow(null),
  codes,
};

export const adminPromotionRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/admin/promotions',
    options: {
      ...read,
      description: 'List promotions with derived status (draft, scheduled, live, ended) and usage',
      tags: ['api', 'admin'],
      validate: { query: Joi.object({ ...pageQuery, q: Joi.string().trim().min(1).max(100), status: Joi.string().valid('draft', 'inactive', 'scheduled', 'live', 'ended') }) },
    },
    handler: async (request, h) => h.response(await listAdminPromotions(db(request), request.query as never)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'POST',
    path: '/admin/promotions',
    options: {
      ...write,
      description: 'Create a draft automatic or code promotion',
      tags: ['api', 'admin'],
      validate: { payload: Joi.object({ ...fields, name: fields.name.required(), kind: fields.kind.required(), configuration: fields.configuration.required() }) },
    },
    handler: async (request, h) => {
      const row = await audited(request, (tx) => createPromotion(tx, request.auth.credentials.adminId!, request.payload as PromotionInput), (row) => ({ action: 'promotion.create', resourceType: 'promotion', resourceId: row.id, after: { name: row.name, kind: row.kind, configuration: row.configuration, scope: row.scope } }));
      return h.response(await getAdminPromotion(db(request), row.id)).code(201).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'GET',
    path: '/admin/promotions/{id}',
    options: { ...read, description: 'Promotion with codes and redemption stats', tags: ['api', 'admin'], validate: { params: uuidParam('id') } },
    handler: async (request, h) => h.response(await getAdminPromotion(db(request), (request.params as { id: string }).id)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'PATCH',
    path: '/admin/promotions/{id}',
    options: { ...write, description: 'Edit a promotion; codes are upserted and never deleted', tags: ['api', 'admin'], validate: { params: uuidParam('id'), payload: Joi.object(fields).min(1) } },
    handler: async (request, h) => {
      const { id } = request.params as { id: string };
      await audited(
        request,
        (tx) => updatePromotion(tx, id, request.payload as PromotionPatch),
        ({ before, after }) => ({
          action: 'promotion.update',
          resourceType: 'promotion',
          resourceId: id,
          before: { name: before.name, kind: before.kind, configuration: before.configuration, scope: before.scope, startsAt: before.startsAt, endsAt: before.endsAt, totalUsageLimit: before.totalUsageLimit },
          after: { name: after.name, kind: after.kind, configuration: after.configuration, scope: after.scope, startsAt: after.startsAt, endsAt: after.endsAt, totalUsageLimit: after.totalUsageLimit, codes: (request.payload as PromotionPatch).codes?.map((c) => c.code) },
        }),
      );
      return h.response(await getAdminPromotion(db(request), id)).header('Cache-Control', NO_STORE);
    },
  },
  ...(['activate', 'deactivate'] as const).map(
    (action): ServerRoute => ({
      method: 'POST',
      path: `/admin/promotions/{id}/${action}`,
      options: { ...write, description: `${action === 'activate' ? 'Activate' : 'Deactivate'} a promotion; its schedule is still enforced`, tags: ['api', 'admin'], validate: { params: uuidParam('id'), payload: Joi.any() } },
      handler: async (request, h) => {
        const { id } = request.params as { id: string };
        await audited(request, (tx) => setPromotionState(tx, id, action === 'activate' ? 'active' : 'inactive'), ({ before, after }) => ({ action: `promotion.${action}`, resourceType: 'promotion', resourceId: id, before: { status: before.status }, after: { status: after.status } }));
        return h.response(await getAdminPromotion(db(request), id)).header('Cache-Control', NO_STORE);
      },
    }),
  ),
];
