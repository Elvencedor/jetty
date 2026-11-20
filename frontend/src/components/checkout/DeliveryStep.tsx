"use client";

import { useQuery } from "@tanstack/react-query";
import { Store, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { SelectField, TextField } from "@/components/ui";
import { getDeliveryQuote, isDeliveryUnavailable } from "@/lib/api/pricing";
import type { DeliveryMethod } from "@/lib/api/types";
import { validateField, type DeliveryDetails, type DeliveryErrors } from "@/lib/checkout/validation";
import { formatEstimate, formatNaira } from "@/lib/format";
import { NIGERIAN_STATES } from "@/lib/geo/states";
import { useCartStore } from "@/lib/stores/cart";
import { useDebounced } from "@/components/shell/useDebounced";
import { PrepNotice } from "@/components/shared/PrepNotice";
import { RadioCards } from "./RadioCards";

const METHOD_COPY: Record<DeliveryMethod, { title: string; note: string; icon: React.ReactNode }> = {
  delivery: { title: "Delivery", note: "", icon: <Truck size={20} /> },
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

  // Quote again once the customer stops typing in the area or city, not on every keystroke.
  const area = useDebounced(details.area.trim(), 500);
  const city = useDebounced(details.city.trim(), 500);
  const { data, error, isFetching, isError } = useQuery({
    queryKey: ["delivery-options", details.state, area, city, lines, codes],
    queryFn: ({ signal }) => getDeliveryQuote({ items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })), promotionCodes: codes, deliveryAddress: { state: details.state, ...(city ? { city } : {}), ...(area ? { area } : {}) } }, { signal }),
    enabled: stateOk && lines.length > 0,
    staleTime: 60_000,
  });

  const [showAreas, setShowAreas] = useState(false);
  const range = data?.deliveryRange;
  // Without an area there is no zone to deliver or collect from, so any method picked for another area no longer stands.
  useEffect(() => { if (range && method) onMethod(null); }, [range, method, onMethod]);
  const rangeLabel = range ? (range.minFeeMinor === range.maxFeeMinor ? formatNaira(range.minFeeMinor) : `${formatNaira(range.minFeeMinor)} – ${formatNaira(range.maxFeeMinor)}`) : "";

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
    note: !o.available ? "Not available for this address" : [o.estimate ? formatEstimate(o.estimate) : null, METHOD_COPY[o.method].note].filter(Boolean).join(" · "),
    aside: o.available ? (o.feeMinor === 0 ? "Free" : formatNaira(o.feeMinor)) : undefined,
    disabled: !o.available,
    icon: METHOD_COPY[o.method].icon,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h2 data-step-heading tabIndex={-1} className="font-display text-heading-md font-extrabold outline-none">Where should we deliver?</h2>
      <TextField label="Full name" autoComplete="name" {...field("name")} />
      <TextField label="Phone (WhatsApp updates)" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" {...field("phone")} />
      <TextField label="Email for receipt (optional)" type="email" autoComplete="email" {...field("email")} />
      <TextField label="Address" autoComplete="address-line1" {...field("addressLine1")} />
      <div className="grid grid-cols-2 gap-2.5">
        <TextField label={range ? "Area" : "Area (optional)"} autoComplete="address-line2" {...field("area")} {...(range && !details.area.trim() ? { error: "Enter or pick your area" } : {})} />
        <TextField label="City or town" autoComplete="address-level2" {...field("city")} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <SelectField label="State" {...field("state")} onChange={(e) => onChange({ state: e.target.value })}>
          <option value="">Choose</option>
          {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
        </SelectField>
        <TextField label="Landmark (optional)" {...field("landmark")} />
      </div>
      <TextField label="Note for the rider (optional)" {...field("riderNote")} />

      <div aria-live="polite" aria-busy={isFetching} className="flex flex-col gap-3">
        {data?.prep && stateOk ? <PrepNotice prep={data.prep} zoneDays={data.options.find((o) => o.method === "delivery")?.estimate ?? null} /> : null}
        {!stateOk ? (
          <p className="text-body-sm text-muted">Choose your state to see delivery options.</p>
        ) : isError && !isDeliveryUnavailable(error) ? (
          <p role="alert" className="text-body-sm text-danger">We couldn&apos;t load delivery options. Check your connection and try again.</p>
        ) : !data && !isError ? (
          <p className="text-body-sm text-muted">Checking delivery options…</p>
        ) : range && data ? (
          <div className="flex flex-col gap-2 rounded-lg border-[1.5px] border-line bg-surface p-3.5 text-body-sm">
            <p><strong>Delivery in {details.state}: {rangeLabel}</strong>, depending on your area.</p>
            <p className="text-muted">Enter your area above, or pick it below, to see your exact price.</p>
            <button type="button" onClick={() => setShowAreas((s) => !s)} aria-expanded={showAreas} className="self-start text-label font-bold text-primary-strong">
              {showAreas ? "Hide prices by area" : "View prices by area"}
            </button>
            {showAreas ? (
              <ul className="flex flex-col gap-3">
                {data.areaPrices.map((z) => (
                  <li key={z.zoneId} className="flex flex-col gap-1.5">
                    <p className="flex justify-between font-bold"><span>{z.zoneName}</span><span>{formatNaira(z.feeMinor)}</span></p>
                    <p className="text-caption text-muted">{formatEstimate({ minDays: z.minDays, maxDays: z.maxDays, startsOn: z.startsOn })}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {z.areas.map((a) => (
                        <button key={a} type="button" onClick={() => onChange({ area: a })} className="rounded-pill border border-line-strong px-2.5 py-1 text-caption hover:border-primary">{a}</button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : options.some((o) => !o.disabled) ? (
          <RadioCards legend="Delivery method" name="delivery" options={options} value={method} onChange={onMethod} />
        ) : (
          <p role="alert" className="rounded-lg bg-warning-bg p-3 text-body-sm">We don&apos;t deliver to {details.state} yet. Message us on WhatsApp and we&apos;ll help.</p>
        )}
        {methodError ? <p role="alert" className="mt-2 text-caption font-medium text-danger">{methodError}</p> : null}
      </div>
    </div>
  );
}
