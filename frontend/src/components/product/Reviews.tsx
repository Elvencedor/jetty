import Link from "next/link";
import type { ReviewList } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatRelativeOrAbsolute } from "@/lib/format";

/** Rating summary, a filter by stars (plain links, so it works without script and survives reloads) and the latest reviews. */
export function Reviews({ reviews, basePath, rating }: { reviews: ReviewList; basePath: string; rating: number | undefined }) {
  const { summary } = reviews;
  if (!summary.count) {
    return (
      <section id="reviews" className="flex flex-col gap-2">
        <h2 className="font-display text-heading-sm font-extrabold">Reviews</h2>
        <p className="text-body-sm text-muted">No reviews yet. Reviews appear after a delivered order.</p>
      </section>
    );
  }
  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="flex flex-col gap-4">
      <h2 id="reviews-heading" className="font-display text-heading-sm font-extrabold">Reviews</h2>
      <div className="flex items-center gap-4 rounded-card bg-surface-tint p-4">
        <div className="text-center">
          <p className="font-display text-display-md font-extrabold">{summary.average.toFixed(1)}</p>
          <p className="text-caption text-muted">{summary.count} {summary.count === 1 ? "review" : "reviews"}</p>
        </div>
        <ul className="flex flex-1 flex-col gap-1">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const n = summary.breakdown[String(star) as "1"];
            const pct = Math.round((n / summary.count) * 100);
            return (
              <li key={star} className="flex items-center gap-2 text-caption">
                <Link href={rating === star ? `${basePath}#reviews` : `${basePath}?rating=${star}#reviews`} scroll={false} aria-current={rating === star ? "true" : undefined} className={cn("flex flex-1 items-center gap-2 py-0.5", rating === star && "font-bold text-primary-strong")}>
                  <span className="sr-only">{star} stars, {n} {n === 1 ? "review" : "reviews"}{rating === star ? ", selected, press to show all" : ""}</span>
                  <span aria-hidden="true" className="w-6">{star}★</span>
                  <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-pill bg-surface"><span className="block h-full bg-primary" style={{ width: `${pct}%` }} /></span>
                  <span aria-hidden="true" className="w-6 text-right">{n}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {reviews.data.length === 0 ? (
        <p className="text-body-sm text-muted">No {rating}-star reviews.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {reviews.data.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 border-b border-line-soft pb-4">
              <p className="text-body-sm font-bold"><span aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span> {r.title}</p>
              {r.body ? <p className="text-body-sm text-ink-soft">{r.body}</p> : null}
              <p className="text-caption text-muted">{[r.verifiedBuyer ? "Verified buyer" : null, r.location, formatRelativeOrAbsolute(r.createdAt)].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
