import type { Compared, DashboardData, RevenuePoint, RevenueSeries } from "@/lib/api/admin-dashboard";
import { formatNaira, formatNairaCompact, lagosDateKey } from "@/lib/format";

const DAY_MS = 86_400_000;

export const RANGES = [
  { key: "7d", label: "7d", days: 7, phrase: "the previous 7 days" },
  { key: "30d", label: "30d", days: 30, phrase: "the previous 30 days" },
  { key: "quarter", label: "Quarter", days: 90, phrase: "the previous 90 days" },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"] | "custom";

export type RangeChoice = { key: RangeKey; from: string | null; to: string | null };

/** A YYYY-MM-DD that is a real date, or null. */
const dateKey = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);

/** The range from the address: a preset, or custom with its two days (the last day included). Anything else is the last 30 days. */
export function rangeFromParams(range: string | null, from: string | null, to: string | null): RangeChoice {
  const a = dateKey(from);
  const b = dateKey(to);
  if (range === "custom" && a && b && a <= b && (Date.parse(b) - Date.parse(a)) / DAY_MS < 366) return { key: "custom", from: a, to: b };
  const preset = RANGES.find((r) => r.key === range);
  return { key: preset?.key ?? "30d", from: null, to: null };
}

/** The instants to ask the API for. Days begin at midnight in Lagos (UTC+1, no daylight saving); a custom end day is included. */
export function rangeBounds(choice: RangeChoice, now: Date = new Date()): { from: string; to: string } {
  if (choice.key === "custom" && choice.from && choice.to) {
    const end = new Date(`${choice.to}T00:00:00+01:00`).getTime() + DAY_MS;
    return { from: new Date(`${choice.from}T00:00:00+01:00`).toISOString(), to: new Date(Math.min(end, now.getTime())).toISOString() };
  }
  const days = RANGES.find((r) => r.key === choice.key)?.days ?? 30;
  return { from: new Date(now.getTime() - days * DAY_MS).toISOString(), to: now.toISOString() };
}

/** Day buckets while they stay readable, then weeks, then months. */
export function intervalFor(days: number): RevenueSeries["interval"] {
  return days <= 35 ? "day" : days <= 120 ? "week" : "month";
}

/** How many days a choice covers. */
export const daysIn = (choice: RangeChoice) => (choice.key === "custom" && choice.from && choice.to ? Math.round((Date.parse(choice.to) - Date.parse(choice.from)) / DAY_MS) + 1 : (RANGES.find((r) => r.key === choice.key)?.days ?? 30));

export const phraseFor = (choice: RangeChoice) => (choice.key === "custom" ? "the period before" : RANGES.find((r) => r.key === choice.key)!.phrase);

// ------------------------------------------------------------------ deltas

export type Delta = { text: string; spoken: string; tone: "up" | "down" | "flat" };

/** "▲ 12%" for the pill and "up 12%" for assistive technology. Null when there is nothing to compare with. */
export function deltaOf(c: Compared, unit: "pct" | "pts" = "pct"): Delta | null {
  const change = unit === "pts" ? (c.current !== null && c.previous !== null ? Math.round((c.current - c.previous) * 10) / 10 : null) : c.changePct;
  if (change === null) return null;
  const size = `${Math.abs(change)}${unit === "pts" ? " pts" : "%"}`;
  if (change === 0) return { text: "No change", spoken: "no change", tone: "flat" };
  return change > 0 ? { text: `▲ ${size}`, spoken: `up ${size}`, tone: "up" } : { text: `▼ ${size}`, spoken: `down ${size}`, tone: "down" };
}

/** The greeting headline, written from the revenue change. */
export function headline(name: string, revenue: Compared): string {
  const c = revenue.changePct;
  if (c === null || revenue.current === 0) return `Hey ${name}, here's how the shop is doing`;
  if (c === 0) return `Hey ${name}, sales are flat`;
  return `Hey ${name}, sales are ${c > 0 ? "up" : "down"} ${Math.abs(c)}%`;
}

export const formatPct = (n: number | null) => (n === null ? "No data yet" : `${n}%`);

// -------------------------------------------------------------------- chart

export const CHART = { width: 600, height: 180 } as const;

/** Points for a polyline across the chart, scaled to the largest value in either series. */
export function linePoints(values: number[], max: number): string {
  if (values.length === 0) return "";
  const step = values.length > 1 ? CHART.width / (values.length - 1) : 0;
  return values.map((v, i) => `${(i * step).toFixed(1)},${(CHART.height - (max > 0 ? (v / max) * CHART.height : 0)).toFixed(1)}`).join(" ");
}

/** The ceiling the chart is drawn to: the largest value, with a little room above it. */
export const chartMax = (series: RevenuePoint[][]) => Math.max(0, ...series.flat().map((p) => p.revenueMinor)) * 1.1;

const labelFmt = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const bucketLabel = (key: string, interval: RevenueSeries["interval"]) =>
  interval === "month" ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : interval === "week" ? `Week of ${labelFmt(key)}` : labelFmt(key);

/** Five evenly spaced axis labels (fewer when there are fewer points). */
export function axisTicks(points: RevenuePoint[], count = 5): { index: number; label: string }[] {
  if (points.length === 0) return [];
  const n = Math.min(count, points.length);
  const picks = new Set(Array.from({ length: n }, (_, i) => (n === 1 ? 0 : Math.round((i * (points.length - 1)) / (n - 1)))));
  return [...picks].map((index) => ({ index, label: labelFmt(points[index]!.bucket) }));
}

/** What the chart says in words, for `role="img"`. */
export function chartSummary(d: { revenue: Compared; phrase: string; points: RevenuePoint[]; interval: RevenueSeries["interval"] }): string {
  const total = formatNairaCompact(d.revenue.current ?? 0);
  const delta = deltaOf(d.revenue);
  const peak = d.points.reduce<RevenuePoint | null>((best, p) => (p.revenueMinor > (best?.revenueMinor ?? 0) ? p : best), null);
  const against = delta ? (delta.tone === "flat" ? `, the same as ${d.phrase}` : `, ${delta.spoken} on ${d.phrase}`) : "";
  return `Revenue ${total}${against}${peak ? `; peak ${bucketLabel(peak.bucket, d.interval)}, ${formatNairaCompact(peak.revenueMinor)}` : ""}`;
}

// ----------------------------------------------------------------- the rest

export type FunnelStep = { label: string; count: number; pctOfSessions: number };

export function funnelSteps(f: NonNullable<DashboardData["funnel"]>): FunnelStep[] {
  const pct = (n: number) => (f.sessions > 0 ? Math.min(Math.round((n / f.sessions) * 1000) / 10, 100) : 0);
  return [
    { label: "Sessions", count: f.sessions },
    { label: "Viewed product", count: f.viewedProduct },
    { label: "Added to bag", count: f.addedToBag },
    { label: "Checkout", count: f.checkout },
    { label: "Purchased", count: f.purchased },
  ].map((s) => ({ ...s, pctOfSessions: pct(s.count) }));
}

/** The step where the largest share of shoppers is lost, when one clearly stands out; otherwise null (and the note is hidden). */
export function biggestDrop(steps: FunnelStep[]): { from: string; to: string; lostPct: number } | null {
  let worst: { from: string; to: string; lostPct: number } | null = null;
  for (let i = 1; i < steps.length; i++) {
    const before = steps[i - 1]!.count;
    if (before < 20) continue;
    const lost = Math.round(((before - steps[i]!.count) / before) * 100);
    if (!worst || lost > worst.lostPct) worst = { from: steps[i - 1]!.label.toLowerCase(), to: steps[i]!.label.toLowerCase(), lostPct: lost };
  }
  return worst && worst.lostPct >= 40 ? worst : null;
}

/** The short tag on a campaign tile. */
export const campaignTag = (kind: string, viaCode: boolean) =>
  kind === "buy_x_get_y" ? "1+1" : kind === "free_gift" ? "GIFT" : kind === "percentage" ? "%" : kind === "free_delivery" ? "FREE" : viaCode ? "CODE" : "SALE";

export const money = formatNaira;
export const todayLabel = (now: Date = new Date()) => new Date(`${lagosDateKey(now)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
