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
  state: string;
  areas: string[];
  active: boolean;
  /** "14:00" in the zone's time zone, or null for no same-day delivery cutoff. */
  sameDayCutoffLocal: string | null;
  timezone: string;
  /** A fee in kobo; null means the option is not offered. */
  sameDayFeeMinor: number | null;
  nextDayFeeMinor: number | null;
  nationwideFeeMinor: number | null;
  pickupEnabled: boolean;
};

export type ZoneInput = Partial<Omit<DeliveryZone, "id">> & { id?: string };

export const getSetting = <K extends SettingKey>(key: K, init: Init = {}) => apiFetch<SettingsByKey[K]>(`/admin/settings/${key}`, { auth: "admin", ...init });
export const patchSetting = <K extends SettingKey>(key: K, patch: Partial<SettingsByKey[K]>) => apiFetch<SettingsByKey[K]>(`/admin/settings/${key}`, { method: "PATCH", body: patch, auth: "admin" });

export const listZones = (init: Init = {}) => apiFetch<{ zones: DeliveryZone[] }>("/admin/settings/delivery-zones", { auth: "admin", ...init }).then((r) => r.zones);
export const saveZone = (zone: ZoneInput) => apiFetch<{ zones: DeliveryZone[] }>("/admin/settings/delivery-zones", { method: "PATCH", body: { zones: [zone] }, auth: "admin" }).then((r) => r.zones);
