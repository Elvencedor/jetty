import { apiFetch, type RequestOptions } from "./client";
import type { OrderStatusValue } from "./types";

type Init = Pick<RequestOptions, "signal">;

export type SegmentKey = "vip" | "new" | "returning" | "lapsed";

export type CustomerRow = {
  id: string;
  /** From their latest order: accounts have no name of their own. */
  name: string | null;
  area: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  phoneVerified: boolean;
  orderCount: number;
  lifetimeValueMinor: number;
  lastOrderAt: string | null;
  createdAt: string | null;
  segments: SegmentKey[];
};

export type CustomerPage = { data: CustomerRow[]; page: { nextCursor: string | null } };

export type SegmentSummary = { everyone: number; segments: { key: SegmentKey; label: string; rule: string; count: number }[] };

export type CustomerDetail = {
  customer: { id: string; phone: string | null; email: string | null; status: string; phoneVerifiedAt: string | null; emailVerifiedAt: string | null; createdAt: string };
  lastOrder: { name: string | null; area: string | null; state: string | null; addressLine: string | null } | null;
  orderCount: number;
  lifetimeValueMinor: number;
  lastOrderAt: string | null;
  recentOrders: { id: string; orderNumber: string; status: OrderStatusValue; paymentStatus: string; totalMinor: number; createdAt: string }[];
};

export const listAdminCustomers = (query: { q?: string; segment?: SegmentKey; sort?: "newest" | "spend"; limit?: number; cursor?: string }, init: Init = {}) =>
  apiFetch<CustomerPage>("/admin/customers", { query, auth: "admin", ...init });
export const getCustomerSegments = (init: Init = {}) => apiFetch<SegmentSummary>("/admin/customers/segments", { auth: "admin", ...init });
export const getAdminCustomer = (id: string, init: Init = {}) => apiFetch<CustomerDetail>(`/admin/customers/${id}`, { auth: "admin", ...init });
