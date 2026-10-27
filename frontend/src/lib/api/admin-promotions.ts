import { apiFetch, type RequestOptions } from "./client";

type Init = Pick<RequestOptions, "signal">;

export type PromotionKind = "percentage" | "fixed_amount" | "buy_x_get_y" | "free_delivery" | "free_gift";
export type PromotionStatus = "draft" | "inactive" | "scheduled" | "live" | "ended";

export type PromotionRow = {
  id: string;
  name: string;
  kind: PromotionKind;
  status: PromotionStatus;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  stackable: boolean;
  type: "code" | "automatic";
  usage: { redemptions: number; openHolds: number; limit: number | null };
  createdAt: string | null;
};

export type PromotionPage = { data: PromotionRow[]; page: { nextCursor: string | null } };

/** What the pricing engine reads. Only the fields a kind uses are present. */
export type PromotionConfiguration = { version?: number; percent?: number; maxDiscountMinor?: number; amountMinor?: number; buy?: number; get?: number; percentOff?: number };
export type PromotionScope = { include?: { allProducts?: boolean; productIds?: string[]; collectionIds?: string[] }; excludeProductIds?: string[] };

export type PromotionDetail = {
  promotion: {
    id: string;
    name: string;
    kind: PromotionKind;
    status: string;
    lifecycle: PromotionStatus;
    configuration: PromotionConfiguration;
    scope: PromotionScope;
    startsAt: string | null;
    endsAt: string | null;
    priority: number;
    stackable: boolean;
    totalUsageLimit: number | null;
    perCustomerLimit: number | null;
    usageCount: number;
    firstOrderOnly: boolean;
    minimumSubtotalMinor: number | null;
  };
  codes: { id: string; code: string; maxRedemptions: number | null; active: boolean }[];
  stats: { redemptions: number; discountMinor: number; orderRevenueMinor: number; openHolds: number };
};

export type PromotionInput = {
  name: string;
  kind: Exclude<PromotionKind, "free_gift">;
  configuration: PromotionConfiguration;
  scope: PromotionScope;
  startsAt: string | null;
  endsAt: string | null;
  stackable: boolean;
  totalUsageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  minimumSubtotalMinor: number | null;
  codes?: { code: string }[];
};

export type Collection = { id: string; name: string; slug: string; active: boolean };

export const listAdminPromotions = (query: { q?: string; status?: PromotionStatus; limit?: number; cursor?: string } = {}, init: Init = {}) => apiFetch<PromotionPage>("/admin/promotions", { query, auth: "admin", ...init });
export const getAdminPromotion = (id: string, init: Init = {}) => apiFetch<PromotionDetail>(`/admin/promotions/${id}`, { auth: "admin", ...init });
export const createAdminPromotion = (input: PromotionInput) => apiFetch<PromotionDetail>("/admin/promotions", { method: "POST", body: input, auth: "admin" });
export const updateAdminPromotion = (id: string, patch: Partial<PromotionInput>) => apiFetch<PromotionDetail>(`/admin/promotions/${id}`, { method: "PATCH", body: patch, auth: "admin" });
export const setPromotionActive = (id: string, active: boolean) => apiFetch<PromotionDetail>(`/admin/promotions/${id}/${active ? "activate" : "deactivate"}`, { method: "POST", body: {}, auth: "admin" });
export const listAdminCollections = (init: Init = {}) => apiFetch<{ data: Collection[] }>("/admin/collections", { auth: "admin", ...init }).then((r) => r.data);
