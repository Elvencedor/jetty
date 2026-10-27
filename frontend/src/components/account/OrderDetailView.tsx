"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { PriceSummary, type SummaryData } from "@/components/bag/PriceSummary";
import { OrderTracker } from "@/components/order/OrderTracker";
import { Button, EmptyState, Media, Skeleton, StatusPill } from "@/components/ui";
import { getMyOrder } from "@/lib/api/account";
import { isApiError } from "@/lib/api/client";
import type { OrderDetail } from "@/lib/api/types";
import { formatDateTime, formatEstimate, formatNaira, formatPhone } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { ReviewForm } from "./ReviewForm";

const FINAL = new Set(["delivered", "cancelled", "refunded"]);

/** An order's totals in the shape the shared summary expects; the numbers are the order's own, nothing recomputed. */
const asSummary = (o: OrderDetail): SummaryData => ({
  subtotalMinor: o.totals.subtotalMinor,
  discountMinor: o.totals.discountMinor,
  deliveryFeeMinor: o.totals.deliveryFeeMinor,
  taxMinor: o.totals.taxMinor,
  totalMinor: o.totals.totalMinor,
  promotions: { applied: o.promotions.map((p, i) => ({ promotionId: String(i), name: "Discount", kind: "", code: p.code, discountMinor: p.discountMinor })) },
  delivery: { method: o.deliveryMethod, zoneId: "", zoneName: o.deliveryAddress.zoneName ?? "", baseFeeMinor: o.totals.deliveryFeeMinor, feeMinor: o.totals.deliveryFeeMinor, freeDeliveryPromotionId: null, estimate: o.estimate },
});

export function OrderDetailView({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["my-order", orderId],
    queryFn: ({ signal }) => getMyOrder(orderId, { signal }),
    refetchInterval: (query) => (query.state.data && FINAL.has(query.state.data.status) ? false : 30_000),
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 2,
  });

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.isError) {
    return (
      <EmptyState title={isApiError(q.error) && q.error.status === 404 ? "We can't find that order" : "We couldn't load this order"} action={<Button href="/account/orders">Back to my orders</Button>}>
        {isApiError(q.error) && q.error.status === 404 ? "It may belong to a different account." : "Check your connection and try again."}
      </EmptyState>
    );
  }
  const o = q.data;
  const pill = ORDER_STATUS[o.status];
  const closed = o.status === "cancelled" || o.status === "refunded";
  const addr = o.deliveryAddress;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-heading-lg font-extrabold">Order #{o.orderNumber}</h1>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </div>
      <p className="text-body-sm text-muted">Placed {formatDateTime(o.placedAt ?? o.createdAt)}</p>
      {!closed ? <OrderTracker status={o.status} /> : null}
      {o.estimate && !FINAL.has(o.status) ? <p className="rounded-lg bg-surface-tint p-3 text-body-sm font-semibold">Arriving {formatEstimate(o.estimate)}</p> : null}
      {o.rider?.name ? (
        <p className="rounded-lg bg-surface-tint p-3 text-body-sm">{o.rider.name} is delivering your order.{o.rider.phone ? <> <a href={`tel:${o.rider.phone}`} className="font-semibold underline">Call {formatPhone(o.rider.phone)}</a></> : null}</p>
      ) : null}

      <ul aria-label="Items" className="flex flex-col gap-4">
        {o.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-3">
            <div className="flex gap-3">
              <Media image={item.image} alt="" aspect="1 / 1.2" sizes="64px" className="w-16 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-body-sm font-bold">{item.slug ? <Link href={`/p/${item.slug}`}>{item.title}</Link> : item.title}</p>
                <p className="text-caption text-muted">{[...Object.values(item.options), `Qty ${item.quantity}`].join(" · ")}</p>
                {item.reviewable && reviewing !== item.id ? <Button variant="soft" size="sm" className="mt-2" onClick={() => setReviewing(item.id)}>Write a review</Button> : null}
              </div>
              <p className="text-body-sm font-bold">{formatNaira(item.lineTotalMinor)}</p>
            </div>
            {reviewing === item.id ? <ReviewForm orderItemId={item.id} title={item.title} onDone={() => queryClient.invalidateQueries({ queryKey: ["my-order", orderId] })} /> : null}
          </li>
        ))}
      </ul>

      <section aria-label="Delivery" className="rounded-lg bg-surface-tint p-4 text-body-sm">
        <p className="font-bold">{addr.recipientName}</p>
        <p className="text-ink-soft">{[addr.addressLine1, addr.area, addr.city, addr.state].filter(Boolean).join(", ")}</p>
        <p className="text-ink-soft">{formatPhone(o.contact.phone)}</p>
      </section>

      <PriceSummary quote={asSummary(o)} busy={false} />
      <Button href="/account/orders" variant="outline" className="self-start">All orders</Button>
    </div>
  );
}
