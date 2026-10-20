"use client";

import { useQuery } from "@tanstack/react-query";
import { Bike, Package, Store, Truck } from "lucide-react";
import { SelectField, TextField } from "@/components/ui";
import { getDeliveryQuote } from "@/lib/api/pricing";
import type { DeliveryMethod } from "@/lib/api/types";
import { validateField, type DeliveryDetails, type DeliveryErrors } from "@/lib/checkout/validation";
import { formatEstimate, formatNaira } from "@/lib/format";
import { NIGERIAN_STATES } from "@/lib/geo/states";
import { useCartStore } from "@/lib/stores/cart";
import { RadioCards } from "./RadioCards";

const METHOD_COPY: Record<DeliveryMethod, { title: string; note: string; icon: React.ReactNode }> = {
  same_day: { title: "Same-day delivery", note: "Order before the cut-off", icon: <Bike size={20} /> },
  next_day: { title: "Next-day delivery", note: "Arrives tomorrow", icon: <Truck size={20} /> },
  nationwide: { title: "Nationwide delivery", note: "Via our courier partners", icon: <Package size={20} /> },
  pickup: { title: "Pick up at our showroom", note: "Collect when it's ready", icon: <Store size={20} /> },
};

type Props = {
  details: DeliveryDetails;
  errors: DeliveryErrors;
  method: DeliveryMethod | null;
  methodError?: string | undefined;
  onChange: (patch: Partial<DeliveryDetails>) => void;
  onBlurField: (field: keyof DeliveryDetails, error: string | undefined) => void;
  onMethod: (method: DeliveryMethod | null) => void;
};

/** Step 1: who and where, then how fast. Delivery options come from the server for the chosen state. */
export function DeliveryStep({ details, errors, method, methodError, onChange, onBlurField, onMethod }: Props) {
  const lines = useCartStore((s) => s.lines);
  const codes = useCartStore((s) => s.promotionCodes);
  const stateOk = !validateField("state", details.state);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["delivery-options", details.state, lines, codes],
    queryFn: ({ signal }) => getDeliveryQuote({ items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })), promotionCodes: codes, deliveryAddress: { state: details.state, ...(details.city.trim() ? { city: details.city.trim() } : {}), ...(details.area.trim() ? { area: details.area.trim() } : {}) } }, { signal }),
    enabled: stateOk && lines.length > 0,
    staleTime: 60_000,
  });

  const field = (name: keyof DeliveryDetails) => ({
    id: `field-${name}`,
    value: details[name],
    error: errors[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange({ [name]: e.target.value }),
    onBlur: () => onBlurField(name, validateField(name, details[name])),
  });

  const options = (data?.options ?? []).map((o) => ({
    value: o.method,
    title: METHOD_COPY[o.method].title,
    note: !o.available ? (o.reason === "CUTOFF_PASSED" ? "Today's cut-off has passed" : "Not available for this address") : [o.estimate ? formatEstimate(o.estimate) : null, METHOD_COPY[o.method].note].filter(Boolean).join(" · "),
    aside: o.available ? (o.feeMinor === 0 ? "Free" : formatNaira(o.feeMinor)) : undefined,
    disabled: !o.available,
    icon: METHOD_COPY[o.method].icon,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h2 data-step-heading tabIndex={-1} className="font-display text-heading-md font-extrabold outline-none">Where should we deliver?</h2>
      <TextField label="Full name" autoComplete="name" {...field("name")} />
      <TextField label="Phone (for delivery updates)" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" {...field("phone")} />
      <TextField label="Email for your receipt (optional)" type="email" autoComplete="email" {...field("email")} />
      <TextField label="Street address" autoComplete="address-line1" {...field("addressLine1")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Area (optional)" autoComplete="address-line2" {...field("area")} />
        <TextField label="City or town" autoComplete="address-level2" {...field("city")} />
      </div>
      <SelectField label="State" autoComplete="address-level1" {...field("state")}>
        <option value="">Choose your state</option>
        {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
      </SelectField>
      <TextField label="Landmark (optional)" {...field("landmark")} />
      <TextField label="Note for the rider (optional)" {...field("riderNote")} />

      <div aria-live="polite" aria-busy={isFetching}>
        {!stateOk ? (
          <p className="text-body-sm text-muted">Choose your state to see delivery options.</p>
        ) : isError ? (
          <p role="alert" className="text-body-sm text-danger">We couldn&apos;t load delivery options. Check your connection and try again.</p>
        ) : !data ? (
          <p className="text-body-sm text-muted">Checking delivery options…</p>
        ) : options.some((o) => !o.disabled) ? (
          <RadioCards legend="Delivery speed" name="delivery" options={options} value={method} onChange={onMethod} />
        ) : (
          <p role="alert" className="rounded-lg bg-warning-bg p-3 text-body-sm">We don&apos;t deliver to this area yet. Message us on WhatsApp and we&apos;ll help.</p>
        )}
        {methodError ? <p role="alert" className="mt-2 text-caption font-medium text-danger">{methodError}</p> : null}
      </div>
    </div>
  );
}
