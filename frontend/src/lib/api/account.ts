import { apiFetch, type RequestOptions } from "./client";
import type { CodeSent, Customer, OrderDetail, OrderSummary, Paged, SessionResponse } from "./types";
import { useCustomerSession } from "@/lib/stores/session";

type Init = Pick<RequestOptions, "signal">;

/** Applies a sign-in response to the session store and returns the customer. */
function startSession(res: SessionResponse): Customer {
  useCustomerSession.getState().setSession({ accessToken: res.accessToken, expiresIn: res.expiresIn, user: res.customer });
  return res.customer;
}

export const register = async (input: { phone: string; password: string; email?: string }, init: Init = {}) =>
  startSession(await apiFetch<SessionResponse>("/auth/register", { method: "POST", body: input, ...init }));

export const signIn = async (input: { phone?: string; email?: string; password: string }, init: Init = {}) =>
  startSession(await apiFetch<SessionResponse>("/auth/login", { method: "POST", body: input, ...init }));

export const requestLoginCode = (phone: string, init: Init = {}) => apiFetch<CodeSent>("/auth/otp/request", { method: "POST", body: { phone }, ...init });

export const verifyLoginCode = async (input: { phone: string; code: string }, init: Init = {}) =>
  startSession(await apiFetch<SessionResponse>("/auth/otp/verify", { method: "POST", body: input, ...init }));

/** Always succeeds with the same body, whether or not the account exists. */
export const forgotPassword = (input: { phone?: string; email?: string }, init: Init = {}) => apiFetch<CodeSent>("/auth/password/forgot", { method: "POST", body: input, ...init });

export const resetPassword = (input: { phone?: string; email?: string; code: string; password: string }, init: Init = {}) =>
  apiFetch<null>("/auth/password/reset", { method: "POST", body: input, ...init });

export async function signOut(): Promise<void> {
  try {
    await apiFetch<null>("/auth/logout", { method: "POST", auth: "customer" });
  } finally {
    // Whatever the server said, this browser is signed out.
    useCustomerSession.getState().clear();
  }
}

export const getMyOrders = (params: { limit?: number; cursor?: string } = {}, init: Init = {}) => apiFetch<Paged<OrderSummary>>("/me/orders", { query: params, auth: "customer", ...init });
export const getMyOrder = (orderId: string, init: Init = {}) => apiFetch<OrderDetail>(`/me/orders/${encodeURIComponent(orderId)}`, { auth: "customer", ...init });

export const submitReview = (input: { orderItemId: string; rating: number; title?: string; body?: string; location?: string }, init: Init = {}) =>
  apiFetch<{ id: string; status: string }>("/reviews", { method: "POST", body: input, auth: "customer", ...init });
