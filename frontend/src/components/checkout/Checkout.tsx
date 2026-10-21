"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { track } from "@/lib/analytics";
import { placeOrder } from "@/lib/api/checkout";
import { useQuote } from "@/lib/cart/useQuote";
import { interpretCheckoutError, type CheckoutFailure } from "@/lib/checkout/errors";
import { buildCheckoutRequest, submissionFor } from "@/lib/checkout/request";
import { firstInvalid, validateDelivery, type DeliveryErrors, type DeliveryDetails } from "@/lib/checkout/validation";
import { formatNaira, formatPhone } from "@/lib/format";
import { useCartStore } from "@/lib/stores/cart";
import { useCheckoutDraft } from "@/lib/stores/checkout-draft";
import { useStoreHydrated } from "@/lib/stores/hydrated";
import { usePaymentSession } from "@/lib/stores/payment-session";
import { useCustomerSession } from "@/lib/stores/session";
import { DeliveryStep } from "./DeliveryStep";
import { PaymentStep } from "./PaymentStep";
import { ReviewStep } from "./ReviewStep";
import { STEPS, StepIndicator, type StepKey } from "./StepIndicator";

const isStep = (v: string | null): v is StepKey => STEPS.some((s) => s.key === v);

/** The three-step checkout. The server prices and validates everything; this collects, checks the obvious, and submits. */
export function Checkout() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const cartReady = useStoreHydrated(useCartStore);
  const draftReady = useStoreHydrated(useCheckoutDraft);
  const lines = useCartStore((s) => s.lines);
  const codes = useCartStore((s) => s.promotionCodes);
  const { details, deliveryMethod, paymentMethod, submission } = useCheckoutDraft();
  const { setDetails, setDeliveryMethod, setPaymentMethod, setSubmission } = useCheckoutDraft.getState();
  const quoteState = useQuote({ deliveryAddress: details.state ? { state: details.state } : undefined, ...(deliveryMethod ? { deliveryMethod } : {}) });
  const { quote, busy, views } = quoteState;

  const requested = params.get("step");
  const step: StepKey = isStep(requested) ? requested : "delivery";
  const [errors, setErrors] = useState<DeliveryErrors>({});
  const [methodError, setMethodError] = useState<string>();
  const [paymentError, setPaymentError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  const started = useRef(false);

  const go = (next: StepKey, replace = false) => (replace ? router.replace : router.push)(`/checkout?step=${next}`);

  // Moving between steps moves focus to the new step's heading.
  useEffect(() => {
    document.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [step]);

  useEffect(() => {
    if (!started.current && cartReady && lines.length) {
      started.current = true;
      track("checkout_start");
    }
  }, [cartReady, lines.length]);

  // A signed-in customer's own phone and email save some typing, but never overwrite what was already entered.
  const customer = useCustomerSession((s) => s.user);
  useEffect(() => {
    if (!draftReady || !customer) return;
    const { details: current, setDetails: set } = useCheckoutDraft.getState();
    const patch: Partial<DeliveryDetails> = {
      ...(!current.phone && customer.phone ? { phone: formatPhone(customer.phone) } : {}),
      ...(!current.email && customer.email ? { email: customer.email } : {}),
    };
    if (Object.keys(patch).length) set(patch);
  }, [draftReady, customer]);

  // A step can't be reached by URL before the ones before it are done.
  const deliveryDone = Object.keys(validateDelivery(details)).length === 0 && !!deliveryMethod;
  useEffect(() => {
    if (!draftReady) return;
    if (step !== "delivery" && !deliveryDone) go("delivery", true);
    else if (step === "review" && !paymentMethod) go("payment", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady, step, deliveryDone, paymentMethod]);

  if (!cartReady || !draftReady) return <Skeleton className="h-96 w-full" />;
  if (!lines.length) {
    return (
      <EmptyState title="Your bag is empty" action={<Button href="/shop">Shop wigs</Button>}>
        Add something to your bag to check out.
      </EmptyState>
    );
  }

  function focusField(name: string) {
    document.getElementById(`field-${name}`)?.focus();
  }

  function next() {
    setFailure(null);
    if (step === "delivery") {
      const found = validateDelivery(details);
      setErrors(found);
      const bad = firstInvalid(found);
      if (bad) return focusField(bad);
      if (!deliveryMethod) return setMethodError("Choose how you'd like it delivered");
      setMethodError(undefined);
      go("payment");
    } else if (step === "payment") {
      if (!paymentMethod) return setPaymentError("Choose a payment method");
      setPaymentError(undefined);
      go("review");
    } else {
      void submit();
    }
  }

  async function submit() {
    if (!deliveryMethod || !paymentMethod || !quote || !quoteState.ready) return;
    const request = buildCheckoutRequest({ lines, promotionCodes: codes, details, deliveryMethod, paymentMethod });
    if (!request) return go("delivery");
    // A repeat of the same request reuses its key, so a double tap or lost reply can never create two orders.
    const sub = submissionFor(request, submission);
    setSubmission(sub);
    setSubmitting(true);
    try {
      const res = await placeOrder(request, sub.key);
      usePaymentSession.getState().set({
        orderId: res.orderId,
        orderNumber: res.orderNumber,
        reference: res.reference,
        accessCode: res.accessCode,
        amountMinor: res.amountMinor,
        reservationExpiresAt: res.reservationExpiresAt,
        method: paymentMethod,
        quotedMinor: quote.totalMinor,
      });
      router.push(`/checkout/pay?order=${encodeURIComponent(res.orderId)}`);
    } catch (err) {
      const f = interpretCheckoutError(err);
      setFailure(f);
      if (f.kind === "payment-start" && f.orderId) router.push(`/checkout/pay?order=${encodeURIComponent(f.orderId)}`);
      if (f.kind === "stock" || f.kind === "offer") void queryClient.invalidateQueries({ queryKey: ["quote"] });
      if (f.kind === "fields") {
        setErrors((e) => ({ ...e, ...f.fields }));
        go("delivery");
      }
      setSubmitting(false);
    }
  }

  const label = step === "delivery" ? "Continue to payment" : step === "payment" ? "Review order" : paymentMethod === "bank_transfer" ? "Get transfer details" : quote ? `Pay ${formatNaira(quote.totalMinor)}` : "Pay";
  const canGoBack = step !== "delivery";
  const patch = (p: Partial<DeliveryDetails>) => {
    setDetails(p);
    // Changing the state changes which delivery speeds exist, so the old choice no longer stands.
    if ("state" in p) setDeliveryMethod(null);
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in p))));
  };

  return (
    <div className="mx-auto grid w-full max-w-store gap-6 lg:grid-cols-[minmax(0,var(--container-checkout))_1fr] lg:items-start">
      <div className="flex flex-col gap-5 pb-32 lg:pb-0">
        <h1 className="sr-only">Checkout</h1>
        <header className="flex items-center justify-between gap-3">
          <Link href="/bag" aria-label="Back to bag" className="inline-flex size-11 items-center justify-center rounded-full bg-surface-tint"><ArrowLeft aria-hidden="true" size={20} /></Link>
          <p className="flex items-center gap-1.5 text-body-sm font-bold text-success"><Lock aria-hidden="true" size={16} /> Secure checkout</p>
          <p className="rounded-pill bg-surface-inverse px-3 py-1.5 text-label font-bold text-on-inverse">{quote ? formatNaira(quote.totalMinor) : "…"}</p>
        </header>
        <StepIndicator current={step} onGo={(s) => go(s)} />
        {!customer ? (
          <p className="text-body-sm text-ink-soft">Have an account? <Link href="/account/sign-in?next=%2Fcheckout" className="font-semibold text-primary-strong underline">Sign in</Link> to fill in your details. Guests can check out too.</p>
        ) : null}

        {views.some((v) => v.problem) ? (
          <div role="alert" className="rounded-lg bg-warning-bg p-3 text-body-sm">Something in your bag has changed. <Link href="/bag" className="font-semibold underline">Check your bag</Link></div>
        ) : null}
        {failure ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
            <p>{failure.message}</p>
            {failure.kind === "stock" || failure.kind === "offer" ? <Link href="/bag" className="font-semibold underline">Go to your bag</Link> : null}
          </div>
        ) : null}

        <form onSubmit={(e) => { e.preventDefault(); next(); }} noValidate aria-busy={submitting} className="flex flex-col gap-5">
          <fieldset disabled={submitting} className="contents">
            {step === "delivery" ? (
              <DeliveryStep details={details} errors={errors} method={deliveryMethod} methodError={methodError} onChange={patch} onBlurField={(f, e) => setErrors((prev) => ({ ...prev, [f]: e }))} onMethod={(m) => { setDeliveryMethod(m); setMethodError(undefined); }} />
            ) : step === "payment" ? (
              <PaymentStep method={paymentMethod} error={paymentError} onMethod={(m) => { setPaymentMethod(m); setPaymentError(undefined); }} />
            ) : deliveryMethod && paymentMethod ? (
              <ReviewStep quote={quote} busy={busy} details={details} deliveryMethod={deliveryMethod} paymentMethod={paymentMethod} onEdit={(s) => go(s)} />
            ) : null}
          </fieldset>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:static lg:border-0 lg:pb-0">
            <div className="mx-auto flex max-w-xl gap-3 px-4 py-3 lg:px-0 lg:py-0">
              {canGoBack ? <Button variant="outline" size="lg" disabled={submitting} onClick={() => go(step === "review" ? "payment" : "delivery")}>Back</Button> : null}
              <Button type="submit" size="lg" fullWidth loading={submitting} disabled={step === "review" && (busy || !quoteState.ready)}>{label}</Button>
            </div>
          </div>
        </form>
      </div>

      <aside aria-label="Your order" className="hidden rounded-lg bg-surface-subtle p-4 lg:sticky lg:top-24 lg:block">
        <h2 className="mb-3 font-display text-heading-sm font-extrabold">Your order</h2>
        <ul className="mb-3 flex flex-col gap-2">
          {quote?.lines.map((l) => <li key={l.variantId} className="flex justify-between gap-3 text-body-sm"><span className="min-w-0 truncate">{l.quantity} × {l.title}</span><span className="font-semibold">{formatNaira(l.lineTotalMinor)}</span></li>)}
        </ul>
        <p className="flex justify-between border-t border-line pt-3 font-bold"><span>Total</span><span>{quote ? formatNaira(quote.totalMinor) : "…"}</span></p>
      </aside>
    </div>
  );
}
