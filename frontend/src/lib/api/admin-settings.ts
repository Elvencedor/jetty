import { apiFetch, apiRequest, versionTag, type RequestOptions } from "./client";

type Init = Pick<RequestOptions, "signal">;

export type StoreSettings = { name: string; contactEmail: string; contactPhone: string; whatsappNumber: string; showroomAddress: string; showroomHours: string };
export type PolicySettings = { podMaxOrderMinor: number | null };
export type PaymentMethodKey = "card" | "bank_transfer";
export type PaymentSettings = { enabledMethods: PaymentMethodKey[]; cardHoldMinutes: number; transferHoldMinutes: number };

export type SettingsByKey = { store: StoreSettings; policies: PolicySettings; payments: PaymentSettings };
export type SettingKey = keyof SettingsByKey;

export type DeliveryZone = {
  id: string;
  name: string;
  /** One state ("state") or several that share a price ("nationwide"). A state with a zone of its own is never priced by a nationwide one. */
  scope: "state" | "nationwide";
  /** The state of a "state" zone; null for a nationwide one. */
  state: string | null;
  /** The states a nationwide zone covers; empty for a state zone. */
  states: string[];
  areas: string[];
  active: boolean;
  timezone: string;
  /** The zone's one delivery price in kobo; null means delivery is not offered (pickup only). */
  deliveryFeeMinor: number | null;
  /** How long delivery takes, in whole days from the day the order is placed. */
  deliveryMinDays: number;
  deliveryMaxDays: number;
  pickupEnabled: boolean;
  /** Counts every change; an edit must send the one it read. */
  version: number;
};

export type ZoneInput = Partial<Omit<DeliveryZone, "id">> & { id?: string };

/** A setting with the version an edit of it must send (0 until it has been saved once). */
export type SettingVersioned<T> = { data: T; version: number };
const versionOf = (etag: string | null) => Number(etag?.replace(/[^0-9]/g, "") || 0);

export const getSetting = async <K extends SettingKey>(key: K, init: Init = {}): Promise<SettingVersioned<SettingsByKey[K]>> => {
  const res = await apiRequest<SettingsByKey[K]>(`/admin/settings/${key}`, { auth: "admin", ...init });
  return { data: res.data, version: versionOf(res.etag) };
};
export const patchSetting = async <K extends SettingKey>(key: K, version: number, patch: Partial<SettingsByKey[K]>): Promise<SettingVersioned<SettingsByKey[K]>> => {
  const res = await apiRequest<SettingsByKey[K]>(`/admin/settings/${key}`, { method: "PATCH", body: patch, ifMatch: versionTag(version), auth: "admin" });
  return { data: res.data, version: versionOf(res.etag) };
};

export const listZones = (init: Init = {}) => apiFetch<{ zones: DeliveryZone[] }>("/admin/settings/delivery-zones", { auth: "admin", ...init }).then((r) => r.zones);
export const deleteZone = (id: string) => apiFetch<{ zones: DeliveryZone[] }>(`/admin/settings/delivery-zones/${id}`, { method: "DELETE", auth: "admin" }).then((r) => r.zones);
export const saveZone = (zone: ZoneInput) => apiFetch<{ zones: DeliveryZone[] }>("/admin/settings/delivery-zones", { method: "PATCH", body: { zones: [zone] }, auth: "admin" }).then((r) => r.zones);

/** A stretch of preparation before deliveries go out. Dates are YYYY-MM-DD; null means no bound. */
export type PrepTime = {
  id: string;
  name: string;
  active: boolean;
  mode: "days" | "date";
  days: number | null;
  deliversFrom: string | null;
  activeFrom: string | null;
  activeUntil: string | null;
  appliesTo: "all" | "zones";
  zoneIds: string[];
  version: number;
};
export type PrepTimeInput = Partial<Omit<PrepTime, "id" | "version">>;

export const listPrepTimes = (init: Init = {}) => apiFetch<{ prepTimes: PrepTime[] }>("/admin/settings/prep-times", { auth: "admin", ...init }).then((r) => r.prepTimes);
export const createPrepTime = (input: PrepTimeInput) => apiFetch<{ prepTimes: PrepTime[] }>("/admin/settings/prep-times", { method: "POST", body: input, auth: "admin" }).then((r) => r.prepTimes);
export const updatePrepTime = (id: string, version: number, input: PrepTimeInput) => apiFetch<{ prepTimes: PrepTime[] }>(`/admin/settings/prep-times/${id}`, { method: "PATCH", body: input, ifMatch: versionTag(version), auth: "admin" }).then((r) => r.prepTimes);
export const deletePrepTime = (id: string) => apiFetch<{ prepTimes: PrepTime[] }>(`/admin/settings/prep-times/${id}`, { method: "DELETE", auth: "admin" }).then((r) => r.prepTimes);
