import { apiFetch, type RequestOptions } from "./client";
import type { AdminIdentity, AdminSessionResponse } from "./types";
import { useAdminSession } from "@/lib/stores/session";

type Init = Pick<RequestOptions, "signal">;

/** Counts of orders waiting on someone, for the Orders badge and the overview. */
export type OrdersToAction = { toPack: number; toDispatch: number; outForDelivery: number; awaitingTransfer: number; paymentExceptions: number };

/** Signs an admin in with email and password. The refresh cookie is set by the API; the access token stays in memory. */
export async function adminLogin(input: { email: string; password: string }, init: Init = {}): Promise<AdminIdentity> {
  const res = await apiFetch<AdminSessionResponse>("/admin/auth/login", { method: "POST", body: input, ...init });
  useAdminSession.getState().setSession({ accessToken: res.accessToken, expiresIn: res.expiresIn, user: res.admin });
  return res.admin;
}

export async function adminLogout(): Promise<void> {
  try {
    await apiFetch<null>("/admin/auth/logout", { method: "POST", auth: "admin" });
  } finally {
    // Whatever the server said, this browser is signed out.
    useAdminSession.getState().clear();
  }
}

export const getAdminMe = (init: Init = {}) => apiFetch<AdminIdentity>("/admin/me", { auth: "admin", ...init });

export const getOrdersToAction = (init: Init = {}) => apiFetch<OrdersToAction>("/admin/orders-to-action", { auth: "admin", ...init });

/** How many reviews are waiting to be moderated (the first page of the queue carries the total). */
export const getPendingReviewCount = (init: Init = {}) =>
  apiFetch<{ page: { total: number | null } }>("/admin/reviews", { query: { status: "pending", limit: 1 }, auth: "admin", ...init }).then((r) => r.page.total ?? 0);
