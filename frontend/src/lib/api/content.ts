import { apiFetch, type RequestOptions } from "./client";
import type { HomeContent, StaticPage, StoreSettings } from "./types";

type Init = Pick<RequestOptions, "signal" | "next">;

export const getHome = (init: Init = {}) => apiFetch<{ data: HomeContent }>("/storefront/home", init).then((r) => r.data);
export const getStoreSettings = (init: Init = {}) => apiFetch<{ data: StoreSettings }>("/storefront/settings", init).then((r) => r.data);
export const getPage = (slug: string, init: Init = {}) => apiFetch<{ data: StaticPage }>(`/content/pages/${encodeURIComponent(slug)}`, init).then((r) => r.data);
