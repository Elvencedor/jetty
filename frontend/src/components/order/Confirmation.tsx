"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Package, Truck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { getCheckoutStatus } from "@/lib/api/checkout";
import { isApiError } from "@/lib/api/client";
import { getStoreSettings } from "@/lib/api/content";
import type { CheckoutStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatEstimate, formatNaira } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { OrderTracker } from "./OrderTracker";

const FINAL = new Set(["delivered", "cancelled", "refunded"]);
const POLL_MS = 30_000;

/** What the courier card says at each stage. The rider's name and number are shown on the signed-in order page. */
function courier(status: CheckoutStatus["status"], pickup: boolean) {
  if (pickup) return { title: "Ready for pickup", note: "We'll message you when it's ready at the showroom.", icon: Package };
  if (status === "out_for_delivery") return { title: "On the way", note: "Your rider is heading to you.", icon: Truck };
  if (status === "delivered") return { title: "Delivered", note: "We hope you love it.", icon: Check };
  return { title: "Packing at our studio", note: "A rider is assigned once it's packed.", icon: Package };
}

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
  const settings = useQuery({ queryKey: ["store-settings"], queryFn: ({ signal }) => getStoreSettings({ signal }), staleTime: 10 * 60_000 });
  const loadedId = data?.orderId;
  useEffect(() => {
    if (loadedId) heading.current?.focus();
  }, [loadedId]);

  if (isPending) return <Skeleton className="mx-auto h-72 w-full max-w-xl rounded-b-2xl" />;
  if (error || !data) {
    return (
      <div className="px-4 pt-4">
        <EmptyState title="We can't show this order here" action={<Button href="/track">Track an order</Button>}>
          {isApiError(error) && error.status === 404 ? "For your privacy, only the device that placed the order can open it directly. Use your order number and phone to look it up." : "Check your connection and refresh the page."}
        </EmptyState>
      </div>
    );
  }

  const paid = data.paymentStatus === "paid";
  const closed = data.status === "cancelled" || data.status === "refunded";
  const pill = ORDER_STATUS[data.status];
  const name = data.recipientFirstName;
  const whatsapp = settings.data?.store.whatsappNumber.replace(/\D/g, "");
  const step = courier(data.status, data.deliveryMethod === "pickup");
  const StepIcon = step.icon;
  const festive = paid && !closed;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <section className={cn("relative flex flex-col gap-[18px] overflow-hidden rounded-b-2xl px-5 pb-[34px] pt-5", closed ? "bg-surface-inverse text-on-inverse" : festive ? "bg-primary text-on-primary" : "bg-surface-tint text-ink")}>
        {festive ? <span aria-hidden="true" className="absolute -right-12 -top-10 size-[200px] rounded-full bg-pink-500" /> : null}
        {festive ? <span aria-hidden="true" className="absolute -bottom-14 -left-8 size-[140px] rounded-full bg-pink-700" /> : null}
        <div className="relative flex items-center justify-between">
          <span className="font-display text-[20px] font-extrabold">jetty&rsquo;s hair</span>
          <Link href="/" aria-label="Close" className={cn("inline-flex size-11 items-center justify-center rounded-full", festive ? "bg-white/20 text-on-primary" : "bg-surface text-ink")}><X aria-hidden="true" size={18} strokeWidth={2.2} /></Link>
        </div>
        {festive ? <span aria-hidden="true" className="relative flex size-16 items-center justify-center rounded-[22px] bg-surface text-primary"><Check size={32} strokeWidth={2.6} /></span> : null}
        <div className="relative flex flex-col gap-1.5">
          <h1 ref={heading} tabIndex={-1} className="font-display text-display-xl font-extrabold outline-none">
            {closed ? "This order is closed" : paid ? `Yay, it's yours${name ? `, ${name}` : ""}!` : "Waiting for your payment"}
          </h1>
          {festive ? <p role="status" className="sr-only">Order confirmed</p> : null}
          <p>Order <strong>#{data.orderNumber}</strong> {closed ? `was ${data.status}.` : paid ? "is confirmed. We'll message you as it moves." : "isn't paid yet."}</p>
        </div>
        {festive ? (
          <div className="relative flex items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3.5 text-ink">
            <p className="flex flex-col leading-tight">
              <span className="text-caption font-bold uppercase text-primary-strong">{data.deliveryMethod === "pickup" ? "Ready for pickup" : "Arriving"}</span>
              <span className="font-display text-heading-sm font-extrabold">{data.estimate ? formatEstimate(data.estimate) : "We'll message you"}</span>
            </p>
            <span className="rounded-sm bg-surface-tint px-2.5 py-1 text-caption font-bold text-primary-strong">{pill.label}</span>
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-4 px-4 pt-6">
        {!closed ? (
          <section aria-label="Order progress" className="flex flex-col gap-3.5">
            <OrderTracker status={data.status} />
            {paid ? (
              <div className="flex items-center gap-3 rounded-card bg-surface-tint px-3.5 py-3">
                <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-pink-350 text-primary-deep"><StepIcon size={20} /></span>
                <p className="flex min-w-0 flex-1 flex-col leading-[1.3]"><span className="font-bold">{step.title}</span><span className="text-label text-muted">{step.note}</span></p>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="flex gap-2">
          <Button href="/track" variant="outline" className="h-12 flex-1 text-body-sm">Track this order</Button>
          {whatsapp ? <Button href={`https://wa.me/${whatsapp}`} variant="dark" className="h-12 flex-1 text-body-sm">WhatsApp help</Button> : null}
        </div>

        <section aria-label="Order recap" className="flex flex-col gap-2.5 rounded-card border-[1.5px] border-line p-4">
          <div className="flex items-baseline justify-between"><h2 className="font-display text-heading-xs font-extrabold">What&rsquo;s coming</h2><span className="text-label text-muted">{data.itemCount} {data.itemCount === 1 ? "item" : "items"}</span></div>
          <p className="flex justify-between text-body-sm"><span>Total</span><strong>{formatNaira(data.amountMinor)}</strong></p>
        </section>

        <Button href="/shop" variant="outline" className="self-start">Keep shopping</Button>
      </div>
    </div>
  );
}
