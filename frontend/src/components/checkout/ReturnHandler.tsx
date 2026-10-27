"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { verifyPayment } from "@/lib/api/checkout";
import { isApiError } from "@/lib/api/client";

/** Where Paystack sends the shopper after a redirect-style payment. The reference is checked with the server, never trusted. */
export function ReturnHandler({ reference }: { reference: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState<"missing" | "error" | null>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    verifyPayment(reference).then(
      (status) => router.replace(`/checkout/pay?order=${encodeURIComponent(status.orderId)}`),
      (err) => setFailed(isApiError(err) && err.status === 404 ? "missing" : "error"),
    );
  }, [reference, router]);

  if (failed) {
    return (
      <EmptyState title={failed === "missing" ? "We don't recognise that payment" : "We couldn't confirm your payment yet"} action={<Button href="/track">Track an order</Button>}>
        {failed === "missing" ? "Nothing was charged for this link." : "If you were charged, your order is safe and we'll message you once it's confirmed."}
      </EmptyState>
    );
  }
  return <div className="flex flex-col items-center gap-3 py-16 text-center" role="status"><Spinner /><p className="font-bold">Confirming your payment…</p></div>;
}
