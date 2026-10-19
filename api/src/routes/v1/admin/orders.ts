import type { ServerRoute } from '@hapi/hapi';
import Joi from 'joi';
import { advanceOrder, allowedNext, confirmTransfer, FULFILMENT_STATUSES, getAdminOrder, listAdminOrders, type OrderListInput } from '../../../modules/admin/orders.js';
import { runIdempotent } from '../../../lib/idempotency.js';
import { audit } from '../../../modules/admin/audit.js';
import { refundOrder, type RefundRequest } from '../../../modules/admin/refunds.js';
import { apiError } from '../../../lib/errors.js';
import { audited, db, guard, NO_STORE, pageQuery, uuidParam } from './shared.js';

const note = Joi.string().trim().min(1).max(1000);

export const adminOrderRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/admin/orders',
    options: {
      ...guard('orders:read'),
      description: 'Search and filter orders',
      tags: ['api', 'admin'],
      validate: {
        query: Joi.object({
          ...pageQuery,
          q: Joi.string().trim().min(1).max(100),
          status: Joi.string().valid('pending_payment', 'placed', 'packed', 'out_for_delivery', 'delivered', 'cancelled', 'refunded', 'payment_exception'),
          paymentStatus: Joi.string().valid('pending', 'paid', 'failed', 'refunded'),
          from: Joi.date().iso(),
          to: Joi.date().iso().greater(Joi.ref('from')),
        }),
      },
    },
    handler: async (request, h) => h.response(await listAdminOrders(db(request), request.query as unknown as OrderListInput)).header('Cache-Control', NO_STORE),
  },
  {
    method: 'GET',
    path: '/admin/orders/{id}',
    options: { ...guard('orders:read'), description: 'Order detail with items, payments, timeline and notes', tags: ['api', 'admin'], validate: { params: uuidParam('id') } },
    handler: async (request, h) => {
      const detail = await getAdminOrder(db(request), (request.params as { id: string }).id);
      const { order } = detail;
      return h
        .response({ ...detail, allowedTransitions: order.paymentStatus === 'paid' ? allowedNext(order.status, order.deliveryMethod) : [] })
        .header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'PATCH',
    path: '/admin/orders/{id}/status',
    options: {
      ...guard('orders:fulfil', 'orders:write'),
      description: 'Advance fulfilment one step; appends a timeline event and notifies the customer',
      tags: ['api', 'admin'],
      validate: { params: uuidParam('id'), payload: Joi.object({ status: Joi.string().valid(...FULFILMENT_STATUSES).required(), note }) },
    },
    handler: async (request, h) => {
      const { id } = request.params as { id: string };
      const body = request.payload as { status: (typeof FULFILMENT_STATUSES)[number]; note?: string };
      await audited(request, (tx) => advanceOrder(tx, request.auth.credentials.adminId!, id, body.status, body.note), (result) => ({ action: 'order.status', resourceType: 'order', resourceId: id, before: { status: result.from }, after: { status: result.to, note: body.note } }));
      return h.response(await getAdminOrder(db(request), id).then((d) => ({ ...d, allowedTransitions: allowedNext(d.order.status, d.order.deliveryMethod) }))).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'POST',
    path: '/admin/orders/{id}/notes',
    options: { ...guard('orders:read'), description: 'Add an internal note (never shown to the customer)', tags: ['api', 'admin'], validate: { params: uuidParam('id'), payload: Joi.object({ note: note.required() }) } },
    handler: async (request, h) => {
      const { id } = request.params as { id: string };
      await audited(
        request,
        (tx) => getAdminOrder(tx, id), // 404 for an unknown order
        () => ({ action: 'order.note', resourceType: 'order', resourceId: id, after: { note: (request.payload as { note: string }).note } }),
      );
      return h.response().code(204);
    },
  },
  {
    method: 'POST',
    path: '/admin/orders/{id}/confirm-transfer',
    options: {
      ...guard('orders:write'),
      description: 'Confirm a bank transfer via the provider, or manually with a documented reason; idempotent',
      tags: ['api', 'admin'],
      validate: { params: uuidParam('id'), payload: Joi.object({ manualReason: Joi.string().trim().min(10).max(500) }).allow(null) },
    },
    handler: async (request, h) => {
      const { id } = request.params as { id: string };
      const manualReason = (request.payload as { manualReason?: string } | null)?.manualReason;
      const result = await audited(
        request,
        (tx) => confirmTransfer(tx, request.server.app.payments, id, manualReason),
        (r) => (r.mode === 'none' ? null : { action: 'order.confirm_transfer', resourceType: 'order', resourceId: id, after: { outcome: r.outcome, mode: r.mode, ...(r.mode === 'manual' ? { reason: manualReason } : {}) } }),
      );
      return h.response(result).header('Cache-Control', NO_STORE);
    },
  },
  {
    method: 'POST',
    path: '/admin/orders/{id}/refunds',
    options: {
      ...guard('orders:refund'),
      description: 'Full or partial provider refund of a successful payment; idempotent (Idempotency-Key required)',
      tags: ['api', 'admin'],
      validate: {
        headers: Joi.object({ 'idempotency-key': Joi.string().min(16).max(128).pattern(/^[A-Za-z0-9._~-]+$/).required() }).unknown(true),
        params: uuidParam('id'),
        payload: Joi.object({
          amountMinor: Joi.number().integer().min(1).max(1_000_000_000_000),
          reason: Joi.string().trim().min(5).max(300).required(),
          paymentAttemptId: Joi.string().uuid(),
        }),
      },
    },
    handler: async (request, h) => {
      const { id } = request.params as { id: string };
      const payments = request.server.app.payments;
      if (!payments) throw apiError(503, 'PAYMENTS_UNAVAILABLE', 'Payments are temporarily unavailable.');
      const body = request.payload as RefundRequest;
      const adminId = request.auth.credentials.adminId!;
      const result = await runIdempotent(db(request), { scope: `admin-refund:${adminId}:${id}`, key: String(request.headers['idempotency-key']), payload: body }, async () => {
        const outcome = await refundOrder(db(request), payments, adminId, id, body, (tx, entry) => audit(tx, request, entry));
        if (outcome.ok) return { status: 201, body: outcome };
        // The provider may or may not have accepted it. The amount stays reserved; someone must check the provider dashboard.
        return {
          status: 502,
          body: { error: { code: 'REFUND_STATUS_UNKNOWN', message: 'The payment provider did not confirm the refund. Check the provider dashboard before trying again; the amount stays reserved.', requestId: request.app.requestId, details: [{ refundId: outcome.refundId }] } },
        };
      });
      return h.response(result.body as object).code(result.status).header('Cache-Control', NO_STORE);
    },
  },
];
