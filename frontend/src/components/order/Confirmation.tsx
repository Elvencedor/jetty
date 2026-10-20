"use client";

import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, EmptyState, Skeleton, StatusPill } from "@/components/ui";
import { getCheckoutStatus } from "@/lib/api/checkout";
import { isApiError } from "@/lib/api/client";
import { formatEstimate, formatNaira } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { OrderTracker } from "./OrderTracker";

const FINAL = new Set(["delivered", "cancelled", "refunded"]);
const POLL_MS = 30_000;

/** The page a shopper lands on after paying, and returns to from a link. It keeps itself current while the order moves. */
export function Confirmation({ orderId }: { orderId: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ["checkout-status", orderId],
    queryFn: ({ signal }) => getCheckoutStatus(orderId, { signal }),
    refetchInterval: (q) => (q.state.data && FINAL.has(q.state.data.status) ? false : POLL_MS),
    refetchIntervalInBackground: false,
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 2,
  });
  const loadedId = data?.orderId;
  useEffect(() => {
    if (loadedId) heading.current?.focus();
  }, [loadedId]);

  if (isPending) return <Skeleton className="mx-auto h-72 w-full max-w-xl" />;
  if (error || !data) {
    return (
      <EmptyState title="We can't show this order here" action={<Button href="/track">Track an order</Button>}>
        {isApiError(error) && error.status === 404 ? "For your privacy, only the device that placed the order can open it directly. Use your order number and phone to look it up." : "Check your connection and refresh the page."}
      </EmptyState>
    );
  }

  const paid = data.paymentStatus === "paid";
  const closed = data.status === "cancelled" || data.status === "refunded";
  const pill = ORDER_STATUS[data.status];
  const name = data.recipientFirstName;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 py-4">
      <section className={`flex flex-col gap-3 rounded-b-2xl rounded-t-lg p-6 ${closed ? "bg-surface-inverse text-on-inverse" : paid ? "bg-primary text-on-primary" : "bg-surface-tint"}`}>
        {paid && !closed ? <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-white text-primary"><Check size={32} /></span> : null}
        <h1 ref={heading} tabIndex={-1} className="font-display text-display-md font-extrabold outline-none">
          {closed ? "This order is closed" : paid ? `Yay, it's yours${name ? `, ${name}` : ""}!` : "Waiting for your payment"}
        </h1>
        {paid && !closed ? <p role="status" className="sr-only">Order confirmed</p> : null}
        <p>Order <strong>#{data.orderNumber}</strong> {closed ? `was ${data.status}.` : paid ? "is confirmed." : "isn't paid yet."}</p>
        {paid && !closed ? (
          <div className="flex flex-col items-start gap-1 rounded-lg bg-white p-4 text-ink">
            <p className="text-micro font-bold uppercase tracking-[0.08em] text-muted">{data.deliveryMethod === "pickup" ? "Ready for pickup" : "Arriving"}</p>
            <p className="font-display text-heading-sm font-extrabold">{data.estimate ? formatEstimate(data.estimate) : "We'll message you with the time"}</p>
            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          </div>
        ) : null}
      </section>

      {!closed ? <OrderTracker status={data.status} /> : null}

      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-tint p-4 text-body-sm">
        <div><dt className="text-muted">Items</dt><dd className="font-bold">{data.itemCount}</dd></div>
        <div><dt className="text-muted">Total</dt><dd className="font-bold">{formatNaira(data.amountMinor)}</dd></div>
      </dl>

      <div className="flex flex-wrap gap-3">
        <Button href="/track" variant="outline">Track this order</Button>
        <Button href="/shop" variant="dark">Keep shopping</Button>
      </div>
    </div>
  );
}
