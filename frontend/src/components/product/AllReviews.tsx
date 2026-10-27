"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui";
import { getReviews } from "@/lib/api/catalog";
import { ReviewCard } from "./ReviewCard";

const SHOWN_ABOVE = 5;

/** "See all N reviews": loads the rest of the reviews (after the ones already shown) a page at a time. */
export function AllReviews({ productId, rating, count }: { productId: string; rating: number | undefined; count: number }) {
  const [open, setOpen] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ["reviews", productId, rating ?? 0],
    queryFn: ({ pageParam, signal }) => getReviews(productId, { ...(rating ? { rating } : {}), limit: 20, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    enabled: open,
  });
  const rest = q.data?.pages.flatMap((p) => p.data).slice(SHOWN_ABOVE) ?? [];

  return (
    <div className="flex flex-col gap-3">
      {open && rest.length ? (
        <ul className="flex flex-col gap-2.5">
          {rest.map((r) => <li key={r.id}><ReviewCard review={r} /></li>)}
        </ul>
      ) : null}
      {q.isError ? <p role="alert" className="text-body-sm text-danger">We couldn&apos;t load more reviews.</p> : null}
      {!open ? (
        <Button variant="outline" size="lg" fullWidth onClick={() => setOpen(true)}>See all {count} reviews</Button>
      ) : q.hasNextPage ? (
        <Button variant="outline" size="lg" fullWidth loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Show more reviews</Button>
      ) : q.isPending ? (
        <p role="status" className="text-center text-body-sm text-muted">Loading reviews…</p>
      ) : null}
    </div>
  );
}
