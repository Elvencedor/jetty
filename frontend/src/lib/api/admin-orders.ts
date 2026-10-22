import { apiFetch, type RequestOptions } from "./client";
import type { OrderStatusValue } from "./types";

type Init = Pick<RequestOptions, "signal">;

export type PaymentMethod = "card" | "bank_transfer";

export type AdminOrderRow = {
  id: string;
  orderNumber: string;
  status: OrderStatusValue;
  paymentStatus: string;
  totalMinor: number;
  currency: string;
  deliveryMethod: string;
  phone: string;
  email: string | null;
  recipientName: string | null;
  area: string | null;
  state: string | null;
  hasAccount: boolean;
  itemCount: number;
  items: { title: string; quantity: number; image: { objectKey: string; url: string | null } | null }[];
  placedAt: string | null;
  createdAt: string;
};

export type AdminOrderPage = {
  /** Orders per status under the other filters; first page only. */
  counts: Partial<Record<OrderStatusValue, number>> | null;
  data: AdminOrderRow[];
  page: { nextCursor: string | null };
};

export type AdminOrderQuery = {
  q?: string;
  status?: string;
  method?: PaymentMethod;
  from?: string;
  limit?: number;
  cursor?: string;
};

export type AdminOrderItem = {
  id: string;
  titleSnapshot: string;
  skuSnapshot: string;
  optionsSnapshot: Record<string, string>;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
  image: { objectKey: string; url: string | null } | null;
};

export type AdminOrderDetail = {
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatusValue;
    paymentStatus: string;
    email: string | null;
    phoneE164: string;
    currency: string;
    subtotalMinor: number;
    discountMinor: number;
    deliveryFeeMinor: number;
    taxMinor: number;
    totalMinor: number;
    deliveryMethod: string;
    deliveryAddressSnapshot: { recipientName?: string; line1?: string; line2?: string | null; area?: string | null; city?: string; state?: string; landmark?: string | null };
    appliedPromotions: { name?: string; code?: string | null }[];
    placedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  customer: { id: string | null; phone: string; email: string | null; status: string | null; paidOrders: number; lifetimeValueMinor: number };
  items: AdminOrderItem[];
  timeline: { id: string; fromStatus: OrderStatusValue | null; toStatus: OrderStatusValue; actorType: string; actorId: string | null; note: string | null; createdAt: string }[];
  payments: { id: string; provider: string; reference: string; method: PaymentMethod; status: string; amountMinor: number; currency: string; paidAt: string | null; createdAt: string }[];
  delivery: { carrier: string | null; riderName: string | null; riderPhoneE164: string | null; trackingReference: string | null; estimatedDeliveryAt: string | null; zone: string | null } | null;
  refunds: { id: string; paymentAttemptId: string; amountMinor: number; reason: string | null; status: string; createdAt: string }[];
  notes: { id: string; at: string; adminUserId: string | null; note: string | null }[];
  allowedTransitions: OrderStatusValue[];
};

export type DeliveryFields = Partial<{ carrier: string | null; riderName: string | null; riderPhoneE164: string | null; trackingReference: string | null }>;

export const listAdminOrders = (query: AdminOrderQuery, init: Init = {}) => apiFetch<AdminOrderPage>("/admin/orders", { query, auth: "admin", ...init });
export const getAdminOrder = (id: string, init: Init = {}) => apiFetch<AdminOrderDetail>(`/admin/orders/${id}`, { auth: "admin", ...init });

export const advanceAdminOrder = (id: string, status: "packed" | "out_for_delivery" | "delivered") =>
  apiFetch<AdminOrderDetail>(`/admin/orders/${id}/status`, { method: "PATCH", body: { status }, auth: "admin" });
export const addOrderNote = (id: string, note: string) => apiFetch<null>(`/admin/orders/${id}/notes`, { method: "POST", body: { note }, auth: "admin" });
export const confirmTransfer = (id: string, manualReason?: string) =>
  apiFetch<{ outcome: string; mode: "provider" | "manual" | "none"; status: OrderStatusValue; paymentStatus: string }>(`/admin/orders/${id}/confirm-transfer`, { method: "POST", body: manualReason ? { manualReason } : {}, auth: "admin" });
export const cancelAdminOrder = (id: string, body: { reason: string; restock?: boolean }) => apiFetch<AdminOrderDetail>(`/admin/orders/${id}/cancel`, { method: "POST", body, auth: "admin" });
export const refundAdminOrder = (id: string, body: { reason: string; amountMinor?: number; paymentAttemptId?: string }, idempotencyKey: string) =>
  apiFetch<unknown>(`/admin/orders/${id}/refunds`, { method: "POST", body, idempotencyKey, auth: "admin" });
export const updateOrderDelivery = (id: string, fields: DeliveryFields) => apiFetch<unknown>(`/admin/orders/${id}/delivery`, { method: "PATCH", body: fields, auth: "admin" });
