import type { AdminReview, ReviewStatus, ReviewSummary } from "@/lib/api/admin-reviews";

export const REVIEW_TABS: readonly { key: string; label: string; status: ReviewStatus }[] = [
  { key: "pending", label: "Waiting", status: "pending" },
  { key: "published", label: "Published", status: "approved" },
  { key: "hidden", label: "Hidden", status: "hidden" },
];
export const reviewTab = (key: string | null) => REVIEW_TABS.find((t) => t.key === key) ?? REVIEW_TABS[0]!;

/** "★★★★☆", read out as "4 out of 5 stars" by the caller. */
export const starsText = (rating: number) => "★".repeat(Math.max(0, Math.min(5, rating))) + "☆".repeat(5 - Math.max(0, Math.min(5, rating)));

/** What a reviewer bought, as the card says it: `Bought 20" · 180% · order #JH-10211`. */
export function boughtLine(r: Pick<AdminReview, "variant" | "orderNumber">): string {
  const parts = [...Object.values(r.variant ?? {}), ...(r.orderNumber ? [`order #${r.orderNumber}`] : [])];
  return parts.length ? `Bought ${parts.join(" · ")}` : "";
}

/** The masked contact and where they are: "m•••@example.com · Lekki". */
export const reviewerLine = (r: Pick<AdminReview, "customerEmail" | "customerPhone" | "location">) => [r.customerEmail ?? r.customerPhone, r.location].filter(Boolean).join(" · ");

/** Things worth a second look before approving, said in words (never colour alone). */
export function flagsFor(r: Pick<AdminReview, "title" | "body" | "rating">): string[] {
  const text = `${r.title ?? ""} ${r.body ?? ""}`;
  const flags: string[] = [];
  const digits = (text.match(/\d/g) ?? []).length;
  if (/(\+?\d[\d\s-]{7,}\d)/.test(text) && digits >= 9) flags.push("contains a phone number");
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) flags.push("contains an email address");
  if (/https?:\/\/|www\./i.test(text)) flags.push("contains a link");
  if (r.rating <= 2) flags.push(/deliver|shipping|arrived|courier|late|days/i.test(text) ? "low rating about delivery, consider replying" : "low rating, consider replying");
  return flags;
}

/** Bar widths for the five-to-one distribution, as whole percentages of all published reviews. */
export const barPercent = (count: number, summary: ReviewSummary) => (summary.count ? Math.round((count / summary.count) * 100) : 0);
