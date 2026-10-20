"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { isApiError } from "@/lib/api/client";
import { reportError } from "@/lib/monitoring";
import { startSession } from "@/lib/session/bootstrap";
import { rehydrateAll } from "@/lib/stores/persisted";
import "@/lib/stores/cart"; // registers the persisted cart store for hydration

/** Server state defaults: briefly fresh, never retry something the server has definitively refused. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failures, error) => failures < 2 && (!isApiError(error) || error.retryable),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false, onError: (error) => !isApiError(error) && reportError(error, { source: "mutation" }) },
    },
  });
}

/**
 * Mount-time work for the whole app: fill persisted stores from storage (and keep them in step across tabs) and
 * restore the customer's session from the refresh cookie.
 */
function Bootstrap() {
  useEffect(() => {
    rehydrateAll();
    const onStorage = (event: StorageEvent) => event.key?.startsWith("jh.") && rehydrateAll();
    window.addEventListener("storage", onStorage);
    const stopSession = startSession("customer");
    return () => {
      window.removeEventListener("storage", onStorage);
      stopSession();
    };
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <Bootstrap />
      {children}
    </QueryClientProvider>
  );
}
