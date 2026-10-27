import type { Collection, PromotionDetail, PromotionInput, PromotionKind, PromotionRow, PromotionStatus } from "@/lib/api/admin-promotions";
import { formatNaira, lagosDateKey } from "@/lib/format";
import { parseNairaToMinor } from "./orders";

export type BuiltKind = Exclude<PromotionKind, "free_gift">;

/** The four things a promotion can do (the pricing engine has no free-gift rule yet). */
export const TYPES: { kind: BuiltKind; glyph: string; label: string; note: string }[] = [
  { kind: "percentage", glyph: "%", label: "Percentage off", note: "Like 15% off frontals" },
  { kind: "fixed_amount", glyph: "₦", label: "Fixed amount off", note: "Like ₦5,000 off" },
  { kind: "buy_x_get_y", glyph: "1+1", label: "Buy X get Y", note: "Like buy one, get one free" },
  { kind: "free_delivery", glyph: "→", label: "Free delivery", note: "Delivery costs nothing" },
];
export const KIND_LABEL: Record<PromotionKind, string> = { percentage: "Percentage off", fixed_amount: "Fixed amount off", buy_x_get_y: "Buy X get Y", free_delivery: "Free delivery", free_gift: "Free gift" };

export const STEPS = ["Type", "Rule", "Who & limits", "Schedule"] as const;

export type PromoForm = {
  kind: BuiltKind;
  name: string;
  percent: string;
  amount: string;
  buy: string;
  get: string;
  /** Percent off the free items: 100 is free. */
  percentOff: string;
  scope: "all" | "collections";
  collectionIds: string[];
  access: "automatic" | "code";
  code: string;
  firstOrderOnly: boolean;
  minSpend: string;
  totalUses: string;
  perCustomer: string;
  stackable: boolean;
  /** `YYYY-MM-DDTHH:mm`, Lagos time (what a datetime-local field holds). */
  startsAt: string;
  endsAt: string;
};

export const emptyForm = (): PromoForm => ({ kind: "percentage", name: "", percent: "10", amount: "", buy: "1", get: "1", percentOff: "100", scope: "all", collectionIds: [], access: "automatic", code: "", firstOrderOnly: false, minSpend: "", totalUses: "", perCustomer: "1", stackable: false, startsAt: "", endsAt: "" });

// ------------------------------------------------------------------ dates (Lagos is UTC+1, all year)

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant as the `YYYY-MM-DDTHH:mm` a datetime-local field shows, in Lagos time. */
export function toLagosInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 3_600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** What a datetime-local field holds, as an instant; null when empty or not a date. */
export function fromLagosInput(text: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null;
  const t = Date.parse(`${text}:00+01:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const dayOf = (iso: string) => Number(lagosDateKey(new Date(iso)).slice(8, 10));

// ------------------------------------------------------------------ form <-> API

const int = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
const optionalInt = (text: string) => (text.trim() === "" ? null : int(text));
export const normaliseCodeText = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);

export function formFromPromotion(d: PromotionDetail): PromoForm {
  const p = d.promotion;
  const c = p.configuration;
  const collectionIds = p.scope.include?.collectionIds ?? [];
  return {
    kind: p.kind === "free_gift" ? "percentage" : p.kind,
    name: p.name,
    percent: c.percent !== undefined ? String(c.percent) : "10",
    amount: c.amountMinor !== undefined ? String(c.amountMinor / 100) : "",
    buy: String(c.buy ?? 1),
    get: String(c.get ?? 1),
    percentOff: String(c.percentOff ?? 100),
    scope: collectionIds.length ? "collections" : "all",
    collectionIds,
    access: d.codes.length ? "code" : "automatic",
    code: d.codes[0]?.code ?? "",
    firstOrderOnly: p.firstOrderOnly,
    minSpend: p.minimumSubtotalMinor ? String(p.minimumSubtotalMinor / 100) : "",
    totalUses: p.totalUsageLimit ? String(p.totalUsageLimit) : "",
    perCustomer: p.perCustomerLimit ? String(p.perCustomerLimit) : "",
    stackable: p.stackable,
    startsAt: toLagosInput(p.startsAt),
    endsAt: toLagosInput(p.endsAt),
  };
}

export type FormErrors = Partial<Record<"name" | "percent" | "amount" | "buy" | "get" | "percentOff" | "collections" | "code" | "minSpend" | "totalUses" | "perCustomer" | "startsAt" | "endsAt", string>>;
/** Which step each error belongs to, so a refused save can send the person back to it. */
export const ERROR_STEP: Record<keyof FormErrors, number> = { name: 1, percent: 1, amount: 1, buy: 1, get: 1, percentOff: 1, collections: 1, code: 1, minSpend: 2, totalUses: 2, perCustomer: 2, startsAt: 3, endsAt: 3 };

export function validateForm(f: PromoForm): FormErrors {
  const e: FormErrors = {};
  if (!f.name.trim()) e.name = "Give it a name your team will recognise";
  if (f.kind === "percentage") {
    const n = Number(f.percent);
    if (!f.percent.trim() || Number.isNaN(n) || n < 1 || n > 90) e.percent = "Enter a percentage from 1 to 90";
  }
  if (f.kind === "fixed_amount" && !((parseNairaToMinor(f.amount) ?? 0) > 0)) e.amount = "Enter an amount above ₦0";
  if (f.kind === "buy_x_get_y") {
    if (!((int(f.buy) ?? 0) >= 1)) e.buy = "At least 1";
    if (!((int(f.get) ?? 0) >= 1)) e.get = "At least 1";
    const off = Number(f.percentOff);
    if (Number.isNaN(off) || off <= 0 || off > 100) e.percentOff = "Enter 1 to 100";
  }
  if (f.kind !== "free_delivery" && f.scope === "collections" && f.collectionIds.length === 0) e.collections = "Choose at least one collection, or use all products";
  if (f.access === "code" && !/^[A-Z0-9]{4,20}$/.test(f.code)) e.code = "Use 4 to 20 letters and numbers";
  if (f.minSpend.trim() && parseNairaToMinor(f.minSpend) === null) e.minSpend = "Enter an amount like 50,000, or leave blank";
  if (f.totalUses.trim() && !((int(f.totalUses) ?? 0) >= 1)) e.totalUses = "Enter a whole number, or leave blank for unlimited";
  if (f.perCustomer.trim() && !((int(f.perCustomer) ?? 0) >= 1)) e.perCustomer = "Enter a whole number, or leave blank";
  if (f.startsAt && !fromLagosInput(f.startsAt)) e.startsAt = "Enter a date and time";
  if (f.endsAt && !fromLagosInput(f.endsAt)) e.endsAt = "Enter a date and time";
  const s = fromLagosInput(f.startsAt);
  const en = fromLagosInput(f.endsAt);
  if (s && en && Date.parse(en) <= Date.parse(s)) e.endsAt = "The end has to be after the start";
  return e;
}

/** The form as the API takes it. Call only when `validateForm` found nothing. */
export function toInput(f: PromoForm): PromotionInput {
  const configuration =
    f.kind === "percentage" ? { version: 1, percent: Number(f.percent) }
    : f.kind === "fixed_amount" ? { version: 1, amountMinor: parseNairaToMinor(f.amount)! }
    : f.kind === "buy_x_get_y" ? { version: 1, buy: int(f.buy)!, get: int(f.get)!, percentOff: Number(f.percentOff) }
    : { version: 1 };
  return {
    name: f.name.trim(),
    kind: f.kind,
    configuration,
    scope: f.kind !== "free_delivery" && f.scope === "collections" ? { include: { collectionIds: f.collectionIds } } : {},
    startsAt: fromLagosInput(f.startsAt),
    endsAt: fromLagosInput(f.endsAt),
    stackable: f.stackable,
    totalUsageLimit: optionalInt(f.totalUses),
    perCustomerLimit: optionalInt(f.perCustomer),
    firstOrderOnly: f.firstOrderOnly,
    minimumSubtotalMinor: f.minSpend.trim() ? parseNairaToMinor(f.minSpend) : null,
  };
}

// ------------------------------------------------------------ the sentence and the preview

export type SentencePart = { text: string; field?: "percent" | "amount" | "buy" | "get" | "percentOff" | "scope" };

const scopeText = (f: PromoForm, names: Map<string, string>) => (f.scope === "all" ? "all products" : f.collectionIds.length ? `products in ${f.collectionIds.map((id) => names.get(id) ?? "a collection").join(" and ")}` : "chosen collections");

/** The rule read back in plain English. Parts with a `field` are the values a person can change. */
export function sentenceParts(f: PromoForm, collections: Collection[]): SentencePart[] {
  const names = new Map(collections.map((c) => [c.id, c.name]));
  const num = (v: string, dflt: string) => v.trim() || dflt;
  switch (f.kind) {
    case "percentage": return [{ text: "Take " }, { text: `${num(f.percent, "10")}%`, field: "percent" }, { text: " off " }, { text: scopeText(f, names), field: "scope" }, { text: "." }];
    case "fixed_amount": return [{ text: "Take " }, { text: `₦${num(f.amount, "0")}`, field: "amount" }, { text: " off " }, { text: scopeText(f, names), field: "scope" }, { text: "." }];
    case "buy_x_get_y": return [{ text: "Buy " }, { text: num(f.buy, "1"), field: "buy" }, { text: ` from ${scopeText(f, names)}, get ` }, { text: num(f.get, "1"), field: "get" }, { text: Number(f.percentOff) === 100 ? " free (the cheaper ones)." : ` at ${num(f.percentOff, "100")}% off.` }];
    case "free_delivery": return [{ text: "Delivery is free on the order." }];
  }
}

/** The line on the announcement bar. */
export function announcementText(f: PromoForm, collections: Collection[]): string {
  const names = new Map(collections.map((c) => [c.id, c.name]));
  const what = f.scope === "collections" && f.collectionIds.length ? ` on ${f.collectionIds.map((id) => names.get(id) ?? "selected products").join(" & ")}` : "";
  const rule =
    f.kind === "percentage" ? `${f.percent || "10"}% off${what}`
    : f.kind === "fixed_amount" ? `₦${f.amount || "0"} off${what}`
    : f.kind === "buy_x_get_y" ? `Buy ${f.buy || 1}, get ${f.get || 1}${Number(f.percentOff) === 100 ? " free" : ` at ${f.percentOff}% off`}${what}`
    : "Free delivery";
  return f.access === "code" && f.code ? `${rule} with code ${f.code}` : rule;
}

/** What a shopper would see in the bag for one sample item. Percent and amounts are the form's own; nothing here prices a real order. */
export function bagPreview(f: PromoForm, sampleMinor = 15_000_000): { quantity: number; subtotal: string; discount: { label: string; value: string } | null; total: string } {
  const quantity = f.kind === "buy_x_get_y" ? (int(f.buy) ?? 1) + (int(f.get) ?? 1) : 1;
  const subtotal = sampleMinor * quantity;
  let discount = 0;
  if (f.kind === "percentage") discount = Math.round((subtotal * Math.min(Number(f.percent) || 0, 100)) / 100);
  else if (f.kind === "fixed_amount") discount = Math.min(parseNairaToMinor(f.amount) ?? 0, subtotal);
  else if (f.kind === "buy_x_get_y") discount = Math.round(sampleMinor * (int(f.get) ?? 0) * (Math.min(Number(f.percentOff) || 0, 100) / 100));
  return { quantity, subtotal: formatNaira(subtotal), discount: f.kind === "free_delivery" ? { label: "Delivery", value: "Free" } : discount > 0 ? { label: "Discount", value: `−${formatNaira(discount)}` } : null, total: formatNaira(subtotal - discount) };
}

export const generateCode = (random: () => number = Math.random) => Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(random() * 32)]).join("");

/** The button's label on the last step. */
export function submitLabel(f: PromoForm, editing: boolean, now: Date = new Date()): string {
  if (editing) return "Save changes";
  const start = fromLagosInput(f.startsAt);
  return !start || Date.parse(start) <= now.getTime() ? "Start now" : "Schedule promotion";
}

// ------------------------------------------------------------------ list and calendar

export function summaryText(rows: PromotionRow[]): string {
  const n = (s: PromotionStatus) => rows.filter((r) => r.status === s).length;
  const parts = [`${n("live")} live`, `${n("scheduled")} scheduled`, `${n("ended")} ended`];
  if (n("draft") + n("inactive")) parts.push(`${n("draft") + n("inactive")} not running`);
  return parts.join(" · ");
}

export type CalendarRow = { id: string; name: string; kind: PromotionKind; status: PromotionStatus; /** 1-based grid columns (day 1 is column 1). */ from: number; to: number; label: string };

/** The promotions that touch a month, with the days each spans (open-ended ones run to the edge of the month). */
export function calendarRows(rows: PromotionRow[], year: number, month: number): CalendarRow[] {
  const first = Date.parse(`${year}-${pad(month)}-01T00:00:00+01:00`);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const next = first + days * 86_400_000;
  return rows
    .filter((r) => (r.startsAt ? Date.parse(r.startsAt) < next : true) && (r.endsAt ? Date.parse(r.endsAt) > first : true) && (r.startsAt || r.endsAt))
    .map((r) => {
      const from = r.startsAt && Date.parse(r.startsAt) >= first ? dayOf(r.startsAt) : 1;
      const to = r.endsAt && Date.parse(r.endsAt) < next ? dayOf(r.endsAt) : days;
      return { id: r.id, name: r.name, kind: r.kind, status: r.status, from, to: Math.max(to, from), label: r.type === "code" ? "Code" : "Auto" };
    })
    .sort((a, b) => a.from - b.from || a.name.localeCompare(b.name));
}

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
