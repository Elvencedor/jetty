import { apiFetch, type RequestOptions } from "./client";

type Init = Pick<RequestOptions, "signal">;

export type ReviewStatus = "pending" | "approved" | "rejected" | "hidden";

export type AdminReview = {
  id: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  orderNumber: string | null;
  image: { url: string | null } | null;
  /** Masked: the reviewer's contact with the middle hidden. */
  customerPhone: string | null;
  customerEmail: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  location: string | null;
  status: ReviewStatus;
  verifiedBuyer: boolean;
  /** The options of what they bought, such as { Length: '20"', Density: "180%" }. */
  variant: Record<string, string> | null;
  createdAt: string;
  moderatedAt: string | null;
};

export type ReviewPage = { data: AdminReview[]; page: { total: number | null; nextCursor: string | null } };
export type ReviewSummary = { count: number; average: number | null; distribution: { stars: number; count: number }[] };

export const listAdminReviews = (query: { status?: ReviewStatus; limit?: number; cursor?: string }, init: Init = {}) => apiFetch<ReviewPage>("/admin/reviews", { query, auth: "admin", ...init });
export const getReviewSummary = (init: Init = {}) => apiFetch<ReviewSummary>("/admin/reviews/summary", { auth: "admin", ...init });
export const moderateAdminReview = (id: string, status: "approved" | "hidden") => apiFetch<{ id: string; status: ReviewStatus }>(`/admin/reviews/${id}`, { method: "PATCH", body: { status }, auth: "admin" });
