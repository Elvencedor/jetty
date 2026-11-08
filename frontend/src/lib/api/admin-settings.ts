import { apiFetch, type RequestOptions } from "./client";

type Init = Pick<RequestOptions, "signal">;

export type StoreSettings = { name: string; contactEmail: string; contactPhone: string; whatsappNumber: string; showroomAddress: string; showroomHours: string };
export type PolicySettings = { returnWindowDays: number; podMaxOrderMinor: number | null };
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
};

export type ZoneInput = Partial<Omit<DeliveryZone, "id">> & { id?: string };

export const getSetting = <K extends SettingKey>(key: K, init: Init = {}) => apiFetch<SettingsByKey[K]>(`/admin/settings/${key}`, { auth: "admin", ...init });
export const patchSetting = <K extends SettingKey>(key: K, patch: Partial<SettingsByKey[K]>) => apiFetch<SettingsByKey[K]>(`/admin/settings/${key}`, { method: "PATCH", body: patch, auth: "admin" });

export const listZones = (init: Init = {}) => apiFetch<{ zones: DeliveryZone[] }>("/admin/settings/delivery-zones", { auth: "admin", ...init }).then((r) => r.zones);
export const deleteZone = (id: string) => apiFetch<{ zones: DeliveryZone[] }>(`/admin/settings/delivery-zones/${id}`, { method: "DELETE", auth: "admin" }).then((r) => r.zones);
export const saveZone = (zone: ZoneInput) => apiFetch<{ zones: DeliveryZone[] }>("/admin/settings/delivery-zones", { method: "PATCH", body: { zones: [zone] }, auth: "admin" }).then((r) => r.zones);
