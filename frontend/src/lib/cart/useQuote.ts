"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getQuote } from "@/lib/api/pricing";
import type { DeliveryMethod } from "@/lib/api/types";
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
export type QuoteOptions = { deliveryAddress?: { state: string }; deliveryMethod?: DeliveryMethod };

export function useQuote(options: QuoteOptions = {}) {
  const lines = useCartStore((s) => s.lines);
  const codes = useCartStore((s) => s.promotionCodes);
  const customer = useCustomerSession((s) => s.status);
  const { deliveryAddress, deliveryMethod } = options;
  const state = deliveryAddress?.state;
  const request = useMemo(
    () => ({ items: lines.map(({ variantId, quantity }) => ({ variantId, quantity })), promotionCodes: codes, ...(state && deliveryMethod ? { deliveryAddress: { state }, deliveryMethod } : {}) }),
    [lines, codes, state, deliveryMethod],
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
    retry: 1,
  });

  const quote = lines.length ? query.data : undefined;
  // Waiting on the debounce, or on the server, both count as busy.
  const busy = settled !== request || query.isFetching || customer === "unknown";
  const views = useMemo(() => buildLineViews(lines, quote), [lines, quote]);
  return { quote, views, busy, error: query.isError && !quote, refetch: query.refetch, ready: canCheckout(views, quote, busy) };
}
