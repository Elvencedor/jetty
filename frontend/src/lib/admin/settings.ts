import type { DeliveryZone, PaymentMethodKey, StoreSettings, ZoneInput } from "@/lib/api/admin-settings";
import { formatPhone } from "@/lib/format";
import { minorToAmountText } from "./amount";
import { parseNairaToMinor, riderPhoneToE164 } from "./orders";

export const SETTINGS_SECTIONS = [
  { key: "store", label: "Store details", note: "Name, contact, showroom" },
  { key: "delivery", label: "Delivery & pickup", note: "Zones, prices, delivery times" },
  { key: "payments", label: "Payments", note: "Methods and payment holds" },
  { key: "policies", label: "Returns & policies", note: "Return window" },
] as const;
export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]["key"];
export const sectionByKey = (key: string) => SETTINGS_SECTIONS.find((s) => s.key === key);

/** The fields that differ, as a patch; null when nothing changed. */
export function changedFields<T extends object>(before: T, after: T): Partial<T> | null {
  const patch: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key];
  }
  return Object.keys(patch).length ? patch : null;
}

// ------------------------------------------------------------------ store

export type StoreForm = StoreSettings;
export type StoreErrors = Partial<Record<keyof StoreSettings, string>>;

/** What the form shows for the stored values: phone numbers as people write them. */
export const storeToForm = (s: StoreSettings): StoreForm => ({ ...s, contactPhone: s.contactPhone ? formatPhone(s.contactPhone) : "", whatsappNumber: s.whatsappNumber ? formatPhone(s.whatsappNumber) : "" });

export function validateStore(f: StoreForm): StoreErrors {
  const errors: StoreErrors = {};
  if (!f.name.trim()) errors.name = "Enter the store's name";
  if (f.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contactEmail.trim())) errors.contactEmail = "Enter an email like hello@yourshop.com";
  for (const key of ["contactPhone", "whatsappNumber"] as const) {
    if (f[key].trim() && !riderPhoneToE164(f[key])) errors[key] = "Enter a number like 0803 123 4567, or with +country code";
  }
  return errors;
}

/** The form as the API stores it: trimmed, phone numbers in E.164. */
export const storeToSettings = (f: StoreForm): StoreSettings => ({
  name: f.name.trim(),
  contactEmail: f.contactEmail.trim(),
  contactPhone: f.contactPhone.trim() ? (riderPhoneToE164(f.contactPhone) ?? "") : "",
  whatsappNumber: f.whatsappNumber.trim() ? (riderPhoneToE164(f.whatsappNumber) ?? "") : "",
  showroomAddress: f.showroomAddress.trim(),
  showroomHours: f.showroomHours.trim(),
});

/** What customers would look for and cannot find yet: the contact details left blank. */
export function missingStoreDetails(s: StoreSettings): string[] {
  const blank = (v: string) => !v.trim();
  return [
    ...(blank(s.whatsappNumber) ? ["WhatsApp number"] : []),
    ...(blank(s.contactEmail) ? ["support email"] : []),
    ...(blank(s.contactPhone) ? ["support phone"] : []),
    ...(blank(s.showroomAddress) ? ["showroom address"] : []),
  ];
}

// --------------------------------------------------------------- payments

export const HOLD_OPTIONS = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 45, label: "45 minutes" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 480, label: "8 hours" },
] as const;

/** The choices, plus the stored value when it is none of them (set through the API), so the select never lies. */
export const holdChoices = (current: number) => (HOLD_OPTIONS.some((o) => o.minutes === current) ? [...HOLD_OPTIONS] : [...HOLD_OPTIONS, { minutes: current, label: `${current} minutes` }].sort((a, b) => a.minutes - b.minutes));

export const PAYMENT_METHOD_ROWS: { key: PaymentMethodKey; label: string; note: string }[] = [
  { key: "card", label: "Card", note: "Visa, Mastercard and Verve through Paystack" },
  { key: "bank_transfer", label: "Bank transfer", note: "A one-time account number through Paystack; you confirm or it confirms itself" },
];

/** Switching a method off is refused when it would leave none. */
export const canSwitchOff = (enabled: readonly PaymentMethodKey[], key: PaymentMethodKey) => !(enabled.length === 1 && enabled[0] === key);

// --------------------------------------------------------------- policies

export const RETURN_WINDOWS = [0, 7, 14, 30] as const;
export const returnWindowChoices = (current: number) => (RETURN_WINDOWS.some((d) => d === current) ? [...RETURN_WINDOWS] : [...RETURN_WINDOWS, current].sort((a, b) => a - b));
export const returnWindowLabel = (days: number) => (days === 0 ? "No returns" : `${days} days after delivery`);

// ------------------------------------------------------------------ zones

export type ZoneForm = { name: string; scope: "state" | "nationwide"; state: string; states: string[]; areas: string; deliveryFee: string; minDays: string; maxDays: string; pickupEnabled: boolean };
export type ZoneErrors = Partial<Record<"name" | "state" | "states" | "deliveryFee" | "minDays" | "maxDays", string>>;

/** The longest a delivery time can be set to. */
export const MAX_DELIVERY_DAYS = 60;

const feeText = (minor: number | null) => (minor === null ? "" : minorToAmountText(minor));
export const emptyZone = (): ZoneForm => ({ name: "", scope: "state", state: "", states: [], areas: "", deliveryFee: "", minDays: "1", maxDays: "3", pickupEnabled: false });
export const zoneToForm = (z: DeliveryZone): ZoneForm => ({ name: z.name, scope: z.scope, state: z.state ?? "", states: [...z.states], areas: z.areas.join("\n"), deliveryFee: feeText(z.deliveryFeeMinor), minDays: String(z.deliveryMinDays), maxDays: String(z.deliveryMaxDays), pickupEnabled: z.pickupEnabled });

/** "2 to 4 days", "Next day", "Same day" or "3 days": how long delivery takes, as the owner set it. */
export function deliveryDaysLabel(min: number, max: number): string {
  if (min === max) return min === 0 ? "Same day" : min === 1 ? "Next day" : `${min} days`;
  return `${min} to ${max} days`;
}

/** Areas typed one per line or separated by commas. */
export const parseAreas = (text: string) => {
  const seen = new Set<string>();
  return text.split(/[\n,]/).map((a) => a.trim()).filter((a) => a && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
};

/** A blank fee means "delivery is not offered"; zero means free. */
const feeMinor = (text: string): number | null | "bad" => (text.trim() === "" ? null : (parseNairaToMinor(text) ?? "bad"));

/** Whole days between 0 and the limit, or undefined when the text is not that. */
const wholeDays = (text: string): number | undefined => {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return undefined;
  const n = Number(t);
  return n <= MAX_DELIVERY_DAYS ? n : undefined;
};

export function validateZone(f: ZoneForm): ZoneErrors {
  const errors: ZoneErrors = {};
  if (!f.name.trim()) errors.name = "Name the zone, like Lagos Mainland";
  if (f.scope === "state" && !f.state.trim()) errors.state = "Choose the state";
  if (f.scope === "nationwide" && f.states.length === 0) errors.states = "Pick at least one state";
  if (feeMinor(f.deliveryFee) === "bad") errors.deliveryFee = "Enter an amount like 3,500, or leave blank for pickup only";
  const min = wholeDays(f.minDays);
  const max = wholeDays(f.maxDays);
  if (min === undefined) errors.minDays = `A whole number of days, 0 to ${MAX_DELIVERY_DAYS}`;
  if (max === undefined) errors.maxDays = `A whole number of days, 0 to ${MAX_DELIVERY_DAYS}`;
  else if (min !== undefined && max < min) errors.maxDays = "Can't be shorter than the fastest time";
  return errors;
}

export function zoneToInput(f: ZoneForm, id?: string): ZoneInput {
  return {
    ...(id ? { id } : {}),
    name: f.name.trim(),
    scope: f.scope,
    state: f.scope === "state" ? f.state.trim() : null,
    states: f.scope === "nationwide" ? f.states : [],
    areas: f.scope === "state" ? parseAreas(f.areas) : [],
    deliveryFeeMinor: feeMinor(f.deliveryFee) as number | null,
    deliveryMinDays: wholeDays(f.minDays) ?? 1,
    deliveryMaxDays: wholeDays(f.maxDays) ?? 3,
    pickupEnabled: f.pickupEnabled,
  };
}

/** Where a zone delivers, for its card: "Lagos · whole state", "Rivers · Port Harcourt" or "Nationwide · 5 states". */
export function zoneCoverage(z: DeliveryZone): string {
  if (z.scope === "nationwide") return `Nationwide · ${z.states.length} ${z.states.length === 1 ? "state" : "states"}`;
  return `${z.state ?? ""}${z.areas.length ? ` · ${z.areas.join(", ")}` : " · whole state"}`;
}

/** What a zone charges and how long it takes, for a row of the zones table: nulls where there is no delivery. */
export function zoneDelivery(z: DeliveryZone, format: (minor: number) => string): { price: string | null; time: string | null } {
  if (z.deliveryFeeMinor === null) return { price: null, time: null };
  return { price: z.deliveryFeeMinor === 0 ? "Free" : format(z.deliveryFeeMinor), time: deliveryDaysLabel(z.deliveryMinDays, z.deliveryMaxDays) };
}

/** The options a zone offers, for its card. */
export function zoneOptions(z: DeliveryZone, format: (minor: number) => string): { name: string; note: string; price: string }[] {
  const price = (m: number) => (m === 0 ? "Free" : format(m));
  return [
    ...(z.deliveryFeeMinor !== null ? [{ name: "Delivery", note: deliveryDaysLabel(z.deliveryMinDays, z.deliveryMaxDays), price: price(z.deliveryFeeMinor) }] : []),
    ...(z.pickupEnabled ? [{ name: "Pickup", note: "From the showroom", price: "Free" }] : []),
  ];
}
