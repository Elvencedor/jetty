"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { isApiError } from "@/lib/api/client";
import { getQuote } from "@/lib/api/pricing";
import { unavailableItems } from "@/lib/checkout/unavailable";
import type { DeliveryMethod, PaymentMethod } from "@/lib/api/types";
import { useDebounced } from "@/components/shell/useDebounced";
import { useCartStore } from "@/lib/stores/cart";
import { useCustomerSession } from "@/lib/stores/session";
import { buildLineViews, canCheckout } from "./model";

const QUOTE_DEBOUNCE_MS = 300;

/**
 * The priced bag. Every change to the bag or its codes asks the server again (after a short pause, so tapping "+"
 * three times asks once), the last answer stays on screen while the next one loads, and an answer is re-asked when
 * it expires or the shopper signs in or out (account-only offers).
 */
export type QuoteOptions = { deliveryAddress?: { state: string; area?: string }; deliveryMethod?: DeliveryMethod; paymentMethod?: PaymentMethod };

export function useQuote(options: QuoteOptions = {}) {
  const lines = useCartStore((s) => s.lines);
  const codes = useCartStore((s) => s.promotionCodes);
  const customer = useCustomerSession((s) => s.status);
  const { deliveryAddress, deliveryMethod, paymentMethod } = options;
  const state = deliveryAddress?.state;
  const area = deliveryAddress?.area?.trim() || undefined;
  const request = useMemo(
    () => ({ items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })), promotionCodes: codes, ...(state && deliveryMethod ? { deliveryAddress: { state, ...(area ? { area } : {}) }, deliveryMethod } : {}), ...(paymentMethod ? { paymentMethod } : {}) }),
    [lines, codes, state, area, deliveryMethod, paymentMethod],
  );
  const settled = useDebounced(request, QUOTE_DEBOUNCE_MS);

  const query = useQuery({
    queryKey: ["quote", settled, customer === "authenticated"],
    queryFn: ({ signal }) => getQuote(settled, { signal }),
    enabled: settled.items.length > 0 && customer !== "unknown",
    placeholderData: keepPreviousData,
    staleTime: (q) => {
      const expires = q.state.data ? Date.parse(q.state.data.quoteExpiresAt) - Date.now() : 0;
      return Math.min(Math.max(expires - 5_000, 0), 5 * 60_000);
    },
    refetchOnWindowFocus: true,
    // One more try for trouble that may pass (a dropped connection, a busy server); a plain "no" from the shop will not.
    retry: (count, err) => count < 1 && (!isApiError(err) || err.retryable),
  });

  const quote = lines.length ? query.data : undefined;
  // Items the shop can no longer sell make the whole quote fail. That is not a connection problem: name them.
  const unavailable = useMemo(() => unavailableItems(query.error), [query.error]);
  // Waiting on the debounce, or on the server, both count as busy.
  const busy = settled !== request || query.isFetching || customer === "unknown";
  const views = useMemo(() => buildLineViews(lines, quote), [lines, quote]);
  return { quote, views, busy, unavailable, error: query.isError && !quote && unavailable.length === 0, refetch: query.refetch, ready: canCheckout(views, quote, busy) && unavailable.length === 0 };
}
