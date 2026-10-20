"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, Skeleton, Spinner } from "@/components/ui";
import { getCheckoutStatus, retryPayment, verifyPayment } from "@/lib/api/checkout";
import { isApiError } from "@/lib/api/client";
import { interpretCheckoutError } from "@/lib/checkout/errors";
import { newIdempotencyKey } from "@/lib/checkout/request";
import { CONFIRM_WINDOW_MS, phaseOf, POLL_CARD_MS, POLL_TRANSFER_MS } from "@/lib/checkout/status";
import { formatDuration, formatNaira } from "@/lib/format";
import { openPaystack } from "@/lib/payments/paystack";
import { useCartStore } from "@/lib/stores/cart";
import { useCheckoutDraft } from "@/lib/stores/checkout-draft";
import { useStoreHydrated } from "@/lib/stores/hydrated";
import { usePaymentSession } from "@/lib/stores/payment-session";

/**
 * Everything after the order exists: opening the Paystack window, confirming with the server, waiting for a
 * transfer, and retrying. The browser never decides a payment succeeded: the server's status does.
 */
export function PaymentFlow({ orderId }: { orderId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ready = useStoreHydrated(usePaymentSession);
  const stored = usePaymentSession((s) => s.payment);
  const payment = stored?.orderId === orderId ? stored : null;

  const [confirmingSince, setConfirmingSince] = useState<number | null>(null);
  const [popupBusy, setPopupBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [amountOk, setAmountOk] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const opened = useRef(false);

  const transfer = payment?.method === "bank_transfer";
  const status = useQuery({
    queryKey: ["checkout-status", orderId],
    queryFn: ({ signal }) => getCheckoutStatus(orderId, { signal }),
    refetchInterval: (q) => {
      const s = q.state.data;
      if (s && phaseOf(s, Date.now()) !== "waiting") return false;
      return confirmingSince ? POLL_CARD_MS : transfer ? POLL_TRANSFER_MS : 5000;
    },
    retry: (count, err) => !(isApiError(err) && err.status === 404) && count < 3,
  });
  const phase = status.data ? phaseOf(status.data, now) : "waiting";

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Paid: the bag and the typed details have done their job.
  useEffect(() => {
    if (phase !== "paid") return;
    useCartStore.getState().clear();
    useCheckoutDraft.getState().reset();
    usePaymentSession.getState().set(null);
    router.replace(`/order/${encodeURIComponent(orderId)}/confirmed`);
  }, [phase, orderId, router]);

  const confirm = useCallback(
    async (reference: string) => {
      setConfirmingSince(Date.now());
      try {
        const verified = await verifyPayment(reference);
        queryClient.setQueryData(["checkout-status", orderId], verified);
      } catch {
        // The window may have just closed on a payment that is still settling: polling covers it.
      }
      void queryClient.invalidateQueries({ queryKey: ["checkout-status", orderId] });
    },
    [orderId, queryClient],
  );

  const open = useCallback(async () => {
    if (!payment) return;
    setNotice(null);
    setPopupBusy(true);
    const result = await openPaystack(payment.accessCode);
    setPopupBusy(false);
    if (result.kind === "success") await confirm(result.reference);
    else if (result.kind === "cancelled") setNotice("Payment not completed. You can try again whenever you're ready.");
    else setNotice(result.message);
  }, [payment, confirm]);

  const totalChanged = !!payment && payment.quotedMinor !== payment.amountMinor && !amountOk;

  // Open the window once, automatically, unless the total moved and the shopper has to agree to the new one first.
  useEffect(() => {
    if (!ready || !payment || opened.current || totalChanged || phase !== "waiting" || !status.data) return;
    opened.current = true;
    void open();
  }, [ready, payment, totalChanged, phase, status.data, open]);

  async function tryAgain() {
    setRetrying(true);
    setNotice(null);
    try {
      const res = await retryPayment(orderId, newIdempotencyKey());
      usePaymentSession.getState().set({
        orderId: res.orderId, orderNumber: res.orderNumber, reference: res.reference, accessCode: res.accessCode, amountMinor: res.amountMinor,
        reservationExpiresAt: res.reservationExpiresAt, method: payment?.method ?? "card", quotedMinor: res.amountMinor,
      });
      setConfirmingSince(null);
      opened.current = false;
      await queryClient.invalidateQueries({ queryKey: ["checkout-status", orderId] });
    } catch (err) {
      setNotice(interpretCheckoutError(err).message);
    } finally {
      setRetrying(false);
    }
  }

  if (!ready || status.isPending) return <Skeleton className="mx-auto h-64 w-full max-w-xl" />;
  if (status.isError) {
    return (
      <EmptyState title={isApiError(status.error) && status.error.status === 404 ? "We can't find that order" : "We couldn't check your order"} action={<Button href="/track">Track an order</Button>}>
        {isApiError(status.error) && status.error.status === 404 ? "If you paid, your order is safe: use Track an order with your order number and phone." : "Check your connection and refresh the page."}
      </EmptyState>
    );
  }
  const s = status.data;
  const confirmingTooLong = confirmingSince !== null && now - confirmingSince > CONFIRM_WINDOW_MS;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-6" aria-live="polite">
      <h1 data-step-heading tabIndex={-1} className="font-display text-heading-lg font-extrabold outline-none">Order {s.orderNumber}</h1>

      {phase === "closed" ? (
        <EmptyState title="This order is closed" action={<Button href="/bag">Back to your bag</Button>}>
          It was cancelled or its hold on your items ran out, and no money was taken. Your bag is still here.
        </EmptyState>
      ) : phase === "review" ? (
        <div className="rounded-lg bg-info-bg p-4 text-body-sm">
          We&apos;ve received your payment and our team is checking your order. We&apos;ll message you shortly. <Link href="/track" className="font-semibold underline">Track this order</Link>
        </div>
      ) : phase === "failed" ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg bg-danger-bg p-4 text-danger">
          <p className="font-bold">Your payment didn&apos;t go through. No money was taken.</p>
          {notice ? <p className="text-body-sm">{notice}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={tryAgain} loading={retrying}>Try again</Button>
            <Button variant="outline" href="/checkout?step=payment">Choose another method</Button>
          </div>
        </div>
      ) : totalChanged ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg bg-warning-bg p-4">
          <p className="font-bold">Your total changed to {formatNaira(payment!.amountMinor)}</p>
          <p className="text-body-sm">It was {formatNaira(payment!.quotedMinor)} when you reviewed it. Your items are held while you decide.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAmountOk(true)}>Pay {formatNaira(payment!.amountMinor)}</Button>
            <Button variant="outline" href="/bag">Back to bag</Button>
          </div>
        </div>
      ) : confirmingSince ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-tint p-6 text-center">
          <Spinner />
          <p className="font-bold">Confirming your payment…</p>
          <p className="text-body-sm text-ink-soft">{confirmingTooLong ? "This is taking longer than usual. You don't need to wait: we'll message you once it's confirmed." : "This usually takes a few seconds."}</p>
          {confirmingTooLong ? <Button variant="outline" href="/track">Track this order</Button> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-tint p-5">
          <p className="text-heading-sm font-display font-extrabold">{formatNaira(payment?.amountMinor ?? s.amountMinor)}</p>
          {transfer ? <p className="text-body-sm text-ink-soft">Waiting for your transfer. You can close this page: we&apos;ll message you when it arrives.</p> : <p className="text-body-sm text-ink-soft">Complete your payment in the secure Paystack window.</p>}
          {s.reservationExpiresAt ? <p className="text-caption text-muted">Items held for {formatDuration(Math.max(Date.parse(s.reservationExpiresAt) - now, 0))}</p> : null}
          {notice ? <p role="status" className="text-body-sm font-semibold">{notice}</p> : null}
          {payment ? <Button size="lg" onClick={open} loading={popupBusy}>{transfer ? "Show transfer details" : `Pay ${formatNaira(payment.amountMinor)}`}</Button> : <p className="text-body-sm">Open your latest payment link or <Link href="/track" className="font-semibold underline">track the order</Link>.</p>}
        </div>
      )}
    </div>
  );
}
