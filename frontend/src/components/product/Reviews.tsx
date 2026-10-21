import Link from "next/link";
import type { ReviewList } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { AllReviews } from "./AllReviews";
import { ReviewCard } from "./ReviewCard";

type Props = { productId: string; reviews: ReviewList; basePath: string; rating: number | undefined };

/**
 * Average and star breakdown (each row a link that filters by that rating, so it works without script and survives a
 * reload), the latest reviews as swipeable cards, and "See all" for the rest.
 */
export function Reviews({ productId, reviews, basePath, rating }: Props) {
  const { summary } = reviews;
  if (!summary.count) {
    return (
      <section id="reviews" className="flex flex-col gap-2 pt-2.5">
        <h2 className="font-display text-heading-sm font-extrabold">Reviews</h2>
        <div className="rounded-lg bg-surface-tint p-4 text-body-sm">
          <p className="font-bold">Be the first to review</p>
          <p className="text-ink-soft">Reviews can be written for items from a delivered order.</p>
        </div>
      </section>
    );
  }
  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="flex flex-col gap-3.5 pt-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="reviews-heading" className="font-display text-heading-sm font-extrabold">Reviews</h2>
        <Link href="/account/orders" className="text-body-sm font-bold text-primary-strong">Write one</Link>
      </div>
      <div className="flex items-center gap-3">
        <p className="flex flex-col"><span className="font-display text-[48px] font-extrabold leading-none">{summary.average.toFixed(1)}</span><span className="text-caption text-muted">{summary.count} {summary.count === 1 ? "review" : "reviews"}</span></p>
        <ul className="flex flex-1 flex-col gap-0.5">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const n = summary.breakdown[String(star) as "1"];
            const pct = Math.round((n / summary.count) * 100);
            return (
              <li key={star}>
                <Link href={rating === star ? `${basePath}#reviews` : `${basePath}?rating=${star}#reviews`} scroll={false} aria-current={rating === star ? "true" : undefined} className={cn("flex items-center gap-2 py-1 text-caption", rating === star && "font-bold text-primary-strong")}>
                  <span className="sr-only">{star} stars, {n} {n === 1 ? "review" : "reviews"}{rating === star ? ", selected, press to show all" : ""}</span>
                  <span aria-hidden="true" className="w-6">{star}★</span>
                  <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-tint"><span className="block h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} /></span>
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
        <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
          {reviews.data.map((r) => <li key={r.id} className="w-[270px] shrink-0 lg:w-auto"><ReviewCard review={r} className="h-full" /></li>)}
        </ul>
      )}
      {summary.count > reviews.data.length ? <AllReviews productId={productId} rating={rating} count={rating ? summary.breakdown[String(rating) as "1"] : summary.count} /> : null}
    </section>
  );
}
