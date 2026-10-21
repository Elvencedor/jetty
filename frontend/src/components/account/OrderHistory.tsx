"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button, EmptyState, Skeleton, StatusPill } from "@/components/ui";
import { getMyOrders } from "@/lib/api/account";
import { formatDateTime, formatNaira } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";

/** The customer's orders, newest first, a page at a time. */
export function OrderHistory() {
  const q = useInfiniteQuery({
    queryKey: ["my-orders"],
    queryFn: ({ pageParam, signal }) => getMyOrders({ limit: 10, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
  const orders = q.data?.pages.flatMap((p) => p.data) ?? [];

  if (q.isPending) return <div className="flex flex-col gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  if (q.isError) return <EmptyState title="We couldn't load your orders" action={<Button onClick={() => q.refetch()}>Try again</Button>}>Check your connection and try again.</EmptyState>;
  if (!orders.length) return <EmptyState title="No orders yet" action={<Button href="/shop">Shop wigs</Button>}>When you order, it shows up here.</EmptyState>;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/account/orders/${o.id}`} className="flex flex-col gap-2 rounded-lg border border-line p-4">
              <span className="flex items-center justify-between gap-3">
                <span className="font-bold">#{o.orderNumber}</span>
                <StatusPill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusPill>
              </span>
              <span className="flex items-center justify-between text-body-sm text-ink-soft">
                <span>{formatDateTime(o.placedAt ?? o.createdAt)} · {o.itemCount} {o.itemCount === 1 ? "item" : "items"}</span>
                <span className="font-bold text-ink">{formatNaira(o.totalMinor)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {q.hasNextPage ? <Button variant="outline" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage} className="self-center">Show more</Button> : null}
    </div>
  );
}
