"use client";

import { useQuery } from "@tanstack/react-query";
import { Landmark, Lock, CreditCard } from "lucide-react";
import { getStoreSettings } from "@/lib/api/content";
import type { PaymentMethod } from "@/lib/api/types";
import { RadioCards } from "./RadioCards";

const COPY: Record<PaymentMethod, { title: string; note: string; icon: React.ReactNode; info: string }> = {
  card: { title: "Card", note: "Visa · Mastercard · Verve", icon: <CreditCard size={20} />, info: "You'll enter your card on Paystack's secure page. We never see your card details." },
  bank_transfer: { title: "Bank transfer", note: "Pay from your bank app", icon: <Landmark size={20} />, info: "You'll get a one-time account number to pay into. Your items are held while you transfer." },
};

/** Step 2: how to pay. Only the methods the store has switched on are offered. */
export function PaymentStep({ method, error, onMethod }: { method: PaymentMethod | null; error?: string | undefined; onMethod: (m: PaymentMethod) => void }) {
  const { data, isError } = useQuery({ queryKey: ["store-settings"], queryFn: ({ signal }) => getStoreSettings({ signal }), staleTime: 10 * 60_000 });
  // If settings cannot be read, offer card (the always-on launch method) rather than block the sale.
  const enabled = data?.payments.enabledMethods ?? (isError ? (["card"] as PaymentMethod[]) : null);
  return (
    <div className="flex flex-col gap-4">
      <h2 data-step-heading tabIndex={-1} className="font-display text-heading-md font-extrabold outline-none">How would you like to pay?</h2>
      {!enabled ? (
        <p className="text-body-sm text-muted">Loading payment options…</p>
      ) : enabled.length === 0 ? (
        <p role="alert" className="rounded-lg bg-warning-bg p-3 text-body-sm">Payments are switched off right now. Please try again later or message us on WhatsApp.</p>
      ) : (
        <RadioCards legend="Payment method" name="payment" value={method} onChange={onMethod} options={enabled.map((m) => ({ value: m, title: COPY[m].title, note: COPY[m].note, icon: COPY[m].icon }))} />
      )}
      {method ? <p className="rounded-lg bg-surface-tint p-3 text-body-sm text-ink-soft">{COPY[method].info}</p> : null}
      {error ? <p role="alert" className="text-caption font-medium text-danger">{error}</p> : null}
      <p className="flex items-center gap-2 text-caption text-muted"><Lock aria-hidden="true" size={14} className="text-success" /> Payments are processed securely by Paystack.</p>
    </div>
  );
}
