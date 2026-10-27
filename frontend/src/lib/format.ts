/**
 * Display formatting. Amounts cross the wire as integer minor units (kobo); times are UTC ISO strings that are
 * shown in Lagos time (WAT, UTC+1, no daylight saving). Nothing here calculates a price or a discount.
 */

export const LAGOS_TZ = "Africa/Lagos";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nairaWhole = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** ₦203,000 for whole naira, ₦2,500.50 when there are kobo. Pass `{ kobo: true }` to always show two decimals. */
export function formatNaira(amountMinor: number, options: { kobo?: boolean } = {}): string {
  const whole = amountMinor % 100 === 0;
  return options.kobo || !whole ? naira.format(amountMinor / 100) : nairaWhole.format(amountMinor / 100);
}

/** Signed discount line: −₦117,950. */
export function formatNairaOff(amountMinor: number): string {
  return `−${formatNaira(Math.abs(amountMinor))}`;
}

/** Compact for dashboards: ₦48.6M, ₦204k, ₦1.5k, ₦950. The full value belongs in a tooltip. */
export function formatNairaCompact(amountMinor: number): string {
  const value = amountMinor / 100;
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.0+$/, "");
  if (abs >= 1e9) return `${sign}₦${trim(abs / 1e9, 1)}B`;
  if (abs >= 1e6) return `${sign}₦${trim(abs / 1e6, 1)}M`;
  if (abs >= 1e4) return `${sign}₦${Math.round(abs / 1e3)}k`;
  if (abs >= 1e3) return `${sign}₦${trim(abs / 1e3, 1)}k`;
  return `${sign}${formatNaira(Math.round(abs * 100))}`;
}

// ---------------------------------------------------------------- phone numbers

/**
 * Turns what a Nigerian shopper types (0803 123 4567, +234 803 123 4567, 2348031234567, 803-123-4567) into E.164
 * (+2348031234567). Returns null for anything that is not a valid Nigerian mobile number.
 */
export function normaliseNigerianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "");
  const national =
    /^\+234(\d{10})$/.exec(digits)?.[1] ?? /^234(\d{10})$/.exec(digits)?.[1] ?? /^0(\d{10})$/.exec(digits)?.[1] ?? (/^\d{10}$/.test(digits) ? digits : null);
  // Mobile numbers are ten digits starting 7, 8 or 9 (e.g. 803 123 4567).
  return national && /^[789]/.test(national) ? `+234${national}` : null;
}

/** +2348031234567 → 0803 123 4567 for display. Other numbers are returned as they are. */
export function formatPhone(e164: string): string {
  const m = /^\+234([789]\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Partially hides a number: 0803 ••• 4567. */
export function maskPhone(e164: string): string {
  const m = /^\+234([789]\d{2})\d{3}(\d{4})$/.exec(e164);
  return m ? `0${m[1]} ••• ${m[2]}` : e164;
}

// ------------------------------------------------------------------- date & time

const parts = (date: Date, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS_TZ, ...options }).formatToParts(date).map((p) => [p.type, p.value]));

/** The Lagos calendar date of an instant, as YYYY-MM-DD. */
export function lagosDateKey(date: Date): string {
  const p = parts(date, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "Oct 10, 14:05" in Lagos time. */
export function formatDateTime(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const p = parts(date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.month} ${p.day}, ${p.hour}:${p.minute}`;
}

/** "12 min ago" within a day, then the absolute Lagos time. Admin timestamps use this. */
export function formatRelativeOrAbsolute(input: string | Date, now: Date = new Date()): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 0 || seconds >= 86_400) return formatDateTime(date);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

const DAY_MS = 86_400_000;
const dayNumber = (key: string) => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY_MS);

/** A local date key as "Today", "Tomorrow" or "Tue 21 Oct". */
export function formatDay(key: string, now: Date = new Date()): string {
  const offset = dayNumber(key) - dayNumber(lagosDateKey(now));
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  const p = parts(new Date(`${key}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** A delivery window: "Tomorrow", or "Wed 22 Oct – Fri 24 Oct". */
export function formatEstimate(estimate: { earliestDate: string; latestDate: string }, now: Date = new Date()): string {
  const from = formatDay(estimate.earliestDate, now);
  return estimate.earliestDate === estimate.latestDate ? from : `${from} – ${formatDay(estimate.latestDate, now)}`;
}

/** 3h 20m, 45m, 30s: for visible countdown labels. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

/** "3 hours 41 minutes": spoken form for aria-labels. */
export function describeDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (h > 0) return m > 0 ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
  if (m > 0) return unit(m, "minute");
  return unit(total, "second");
}

/** Whole-number percentage change with its sign, or null when there is no baseline. */
export function formatDelta(pct: number | null): string | null {
  if (pct === null) return null;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`;
}

/**
 * A short "how long ago": today, 3 days ago, 2 wks ago, 5 mo ago; beyond a year, the month and year ("Feb 2025").
 * Used where the exact time does not matter, such as review dates.
 */
export function timeAgo(input: string | Date, now: Date = new Date()): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk${Math.floor(days / 7) === 1 ? "" : "s"} ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS_TZ, month: "short", year: "numeric" }).format(date);
}

/** A calendar date in Lagos time with no time of day: "20 Oct 2026". */
export function formatDate(input: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS_TZ, day: "numeric", month: "short", year: "numeric" }).format(typeof input === "string" ? new Date(input) : input);
}

/** ₦145k, ₦78.5k, ₦950: thousands with at most one decimal, for chips and cards where the exact amount is not needed. */
export function formatNairaK(amountMinor: number): string {
  const naira = Math.abs(amountMinor) / 100;
  const sign = amountMinor < 0 ? "−" : "";
  if (naira < 1000) return `${sign}₦${Math.round(naira)}`;
  return `${sign}₦${(naira / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

/** ₦145k–₦335k, or one figure when both ends are the same. */
export const formatNairaKRange = (min: number, max: number) => (min === max ? formatNairaK(min) : `${formatNairaK(min)}–${formatNairaK(max)}`);
