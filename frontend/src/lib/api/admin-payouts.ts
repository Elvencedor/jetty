import { apiFetch, type RequestOptions } from "./client";

type Init = Pick<RequestOptions, "signal">;

export type PayoutAccount =
  | { configured: false; mode: "live" | "test" }
  | { configured: true; mode: "live" | "test"; subaccountCode: string; businessName: string; bankCode: string; bankName: string; accountName: string; accountLast4: string; updatedAt: string };

export type Bank = { name: string; code: string };

export const getPayoutAccount = (init: Init = {}) => apiFetch<PayoutAccount>("/admin/payouts/account", { auth: "admin", ...init });
export const listBanks = (init: Init = {}) => apiFetch<{ data: Bank[] }>("/admin/payouts/banks", { auth: "admin", ...init }).then((r) => r.data);
export const resolveAccount = (input: { bankCode: string; accountNumber: string }, init: Init = {}) => apiFetch<{ accountName: string }>("/admin/payouts/resolve", { method: "POST", body: input, auth: "admin", ...init });
export const savePayoutAccount = (input: { businessName: string; bankCode: string; accountNumber: string }) => apiFetch<PayoutAccount>("/admin/payouts/account", { method: "PUT", body: input, auth: "admin" });
