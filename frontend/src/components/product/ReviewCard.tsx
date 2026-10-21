import type { Review } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";

/** The line saying what was bought, from the review's variant record when it has one (e.g. `20" · 180%`). */
const bought = (variant: Review["variant"]) => (variant ? Object.values(variant).filter((v): v is string => typeof v === "string").join(" · ") : "");

export function ReviewCard({ review, className }: { review: Review; className?: string }) {
  const who = [review.location, review.verifiedBuyer ? "Verified" : null, bought(review.variant)].filter(Boolean).join(" · ");
  return (
    <article className={cn("flex flex-col gap-2 rounded-lg bg-surface-subtle p-4", className)}>
      <div className="flex items-center justify-between text-label">
        <span role="img" aria-label={`${review.rating} out of 5 stars`} className="font-bold tracking-[1px] text-primary">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
        <span className="text-muted">{timeAgo(review.createdAt)}</span>
      </div>
      {review.title ? <p className="font-bold">{review.title}</p> : null}
      {review.body ? <p className="text-body-sm text-ink-soft">{review.body}</p> : null}
      {who ? <p className="text-caption text-muted">{who}</p> : null}
    </article>
  );
}
