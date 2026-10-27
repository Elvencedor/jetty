import { apiFetch, type RequestOptions } from "./client";

type Init = Pick<RequestOptions, "signal">;

/** A measure for the period and the one before it of the same length; `changePct` is null when there is nothing to compare. */
export type Compared = { current: number | null; previous: number | null; changePct: number | null };

export type DashboardData = {
  range: { from: string; to: string; previous: { from: string; to: string } };
  kpis: { revenueMinor: Compared; orders: Compared; averageOrderValueMinor: Compared; conversionRatePct: Compared; sessions: Compared };
  actionCounts: { toPack: number; toDispatch: number; outForDelivery: number; awaitingTransfer: number; paymentExceptions: number };
  topProducts: { productId: string | null; title: string; units: number; revenueMinor: number; image: { url: string | null } | null; availableQuantity: number; lowStock: boolean }[];
  salesByCategory: { categoryId: string; name: string; units: number; revenueMinor: number }[];
  /** Null when no browsing events were recorded in the period. */
  funnel: { sessions: number; viewedProduct: number; addedToBag: number; checkout: number; purchased: number } | null;
  customers: { newBuyers: number; returningBuyers: number; topStates: { state: string; orders: number; sharePct: number }[] };
  campaigns: { id: string; name: string; kind: string; viaCode: boolean; endsAt: string | null; orders: number; revenueMinor: number }[];
};

export type RevenuePoint = { bucket: string; orders: number; revenueMinor: number };
export type RevenueSeries = { interval: "day" | "week" | "month"; current: RevenuePoint[]; previous: RevenuePoint[] };

export type DashboardRange = { from: string; to: string };

export const getDashboard = (range: DashboardRange, init: Init = {}) => apiFetch<DashboardData>("/admin/dashboard", { query: range, auth: "admin", ...init });
export const getRevenueSeries = (range: DashboardRange, interval: RevenueSeries["interval"], init: Init = {}) =>
  apiFetch<RevenueSeries>("/admin/analytics/revenue", { query: { ...range, interval }, auth: "admin", ...init });
