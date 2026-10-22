import type { DeliveryZone, PaymentMethodKey, StoreSettings, ZoneInput } from "@/lib/api/admin-settings";
import { formatPhone } from "@/lib/format";
import { parseNairaToMinor, riderPhoneToE164 } from "./orders";

export const SETTINGS_SECTIONS = [
  { key: "store", label: "Store details", note: "Name, contact, showroom" },
  { key: "delivery", label: "Delivery & pickup", note: "Zones, prices, cutoffs" },
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

export type ZoneForm = { name: string; state: string; areas: string; sameDayFee: string; nextDayFee: string; nationwideFee: string; cutoff: string; pickupEnabled: boolean };
export type ZoneErrors = Partial<Record<"name" | "state" | "sameDayFee" | "nextDayFee" | "nationwideFee", string>>;

export const CUTOFFS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"] as const;
export const cutoffLabel = (hhmm: string) => {
  const hour = Number(hhmm.slice(0, 2));
  return `${hour > 12 ? hour - 12 : hour}:${hhmm.slice(3)} ${hour >= 12 ? "pm" : "am"}`;
};

const feeText = (minor: number | null) => (minor === null ? "" : String(minor / 100));
export const emptyZone = (): ZoneForm => ({ name: "", state: "", areas: "", sameDayFee: "", nextDayFee: "", nationwideFee: "", cutoff: "", pickupEnabled: false });
export const zoneToForm = (z: DeliveryZone): ZoneForm => ({ name: z.name, state: z.state, areas: z.areas.join("\n"), sameDayFee: feeText(z.sameDayFeeMinor), nextDayFee: feeText(z.nextDayFeeMinor), nationwideFee: feeText(z.nationwideFeeMinor), cutoff: z.sameDayCutoffLocal ?? "", pickupEnabled: z.pickupEnabled });

/** Areas typed one per line or separated by commas. */
export const parseAreas = (text: string) => {
  const seen = new Set<string>();
  return text.split(/[\n,]/).map((a) => a.trim()).filter((a) => a && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
};

/** A blank fee means "not offered"; zero means free. */
const feeMinor = (text: string): number | null | "bad" => (text.trim() === "" ? null : (parseNairaToMinor(text) ?? "bad"));

export function validateZone(f: ZoneForm): ZoneErrors {
  const errors: ZoneErrors = {};
  if (!f.name.trim()) errors.name = "Name the zone, like Lagos Mainland";
  if (!f.state.trim()) errors.state = "Enter the state";
  for (const [key, text] of [["sameDayFee", f.sameDayFee], ["nextDayFee", f.nextDayFee], ["nationwideFee", f.nationwideFee]] as const) {
    if (feeMinor(text) === "bad") errors[key] = "Enter an amount like 3,500, or leave blank to not offer it";
  }
  return errors;
}

export function zoneToInput(f: ZoneForm, id?: string): ZoneInput {
  return {
    ...(id ? { id } : {}),
    name: f.name.trim(),
    state: f.state.trim(),
    areas: parseAreas(f.areas),
    sameDayFeeMinor: feeMinor(f.sameDayFee) as number | null,
    nextDayFeeMinor: feeMinor(f.nextDayFee) as number | null,
    nationwideFeeMinor: feeMinor(f.nationwideFee) as number | null,
    sameDayCutoffLocal: f.cutoff || null,
    pickupEnabled: f.pickupEnabled,
  };
}

/** The options a zone offers, for its card. */
export function zoneOptions(z: DeliveryZone, format: (minor: number) => string): { name: string; note: string; price: string }[] {
  const price = (m: number) => (m === 0 ? "Free" : format(m));
  return [
    ...(z.sameDayFeeMinor !== null ? [{ name: "Same-day", note: z.sameDayCutoffLocal ? `Order before ${cutoffLabel(z.sameDayCutoffLocal)}` : "Same day", price: price(z.sameDayFeeMinor) }] : []),
    ...(z.nextDayFeeMinor !== null ? [{ name: "Next day", note: "Arrives the next day", price: price(z.nextDayFeeMinor) }] : []),
    ...(z.nationwideFeeMinor !== null ? [{ name: "Nationwide", note: "Courier delivery", price: price(z.nationwideFeeMinor) }] : []),
    ...(z.pickupEnabled ? [{ name: "Pickup", note: "From the showroom", price: "Free" }] : []),
  ];
}
