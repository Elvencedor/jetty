"use client";

import { useSyncExternalStore } from "react";
import type { Persistable } from "./persisted";

/** False on the server and on the first client render; true once the store has been filled from storage. */
export function useStoreHydrated(store: Persistable): boolean {
  return useSyncExternalStore(
    (notify) => store.persist.onFinishHydration(notify),
    () => store.persist.hasHydrated(),
    () => false,
  );
}
