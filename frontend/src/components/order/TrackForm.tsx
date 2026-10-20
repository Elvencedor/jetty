"use client";

import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, StatusPill, TextField } from "@/components/ui";
import { trackOrder } from "@/lib/api/checkout";
import { isApiError } from "@/lib/api/client";
import { formatDateTime, normaliseNigerianPhone } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import { OrderTracker } from "./OrderTracker";

/** Guests look an order up with its number and the phone it was placed with. A wrong pair says only "not found". */
export function TrackForm() {
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldError, setFieldError] = useState<{ order?: string; phone?: string }>({});
  const track = useMutation({ mutationFn: (input: { orderNumber: string; phone: string }) => trackOrder(input) });

  function submit(e: FormEvent) {
    e.preventDefault();
    const e164 = normaliseNigerianPhone(phone);
    const number = orderNumber.trim().replace(/^#/, "").toUpperCase();
    const errors = { ...(number ? {} : { order: "Enter your order number" }), ...(e164 ? {} : { phone: "Enter the phone number you ordered with" }) };
    setFieldError(errors);
    if (Object.keys(errors).length || !e164) return;
    track.mutate({ orderNumber: number, phone: e164 });
  }

  const result = track.data;
  const notFound = isApiError(track.error) && track.error.status === 404;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Order number" placeholder="JH-10482" autoCapitalize="characters" value={orderNumber} error={fieldError.order} onChange={(e) => setOrderNumber(e.target.value)} />
        <TextField label="Phone number" type="tel" inputMode="tel" placeholder="0803 123 4567" value={phone} error={fieldError.phone} onChange={(e) => setPhone(e.target.value)} />
        <Button type="submit" size="lg" loading={track.isPending}>Track order</Button>
      </form>
      {track.isError ? (
        <p role="alert" className="rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
          {notFound ? "We couldn't find an order with that number and phone. Check both and try again." : isApiError(track.error) && track.error.status === 429 ? "Too many tries. Please wait a minute and try again." : "We couldn't look that up right now. Please try again."}
        </p>
      ) : null}
      {result ? (
        <section aria-label="Order status" className="flex flex-col gap-4 rounded-lg bg-surface-tint p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-heading-sm font-extrabold">#{result.orderNumber}</h2>
            <StatusPill tone={ORDER_STATUS[result.status].tone}>{ORDER_STATUS[result.status].label}</StatusPill>
          </div>
          {result.status !== "cancelled" && result.status !== "refunded" ? <OrderTracker status={result.status} /> : null}
          {result.placedAt ? <p className="text-caption text-muted">Placed {formatDateTime(result.placedAt)}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
