import { useSyncExternalStore } from "react";
import { createJSONStorage } from "zustand/middleware";

/** JSON storage over the browser's localStorage or sessionStorage. Safe on the server and when storage is blocked. */
export function browserStorage<S>(kind: "local" | "session") {
  return createJSONStorage<S>(() => (kind === "local" ? window.localStorage : window.sessionStorage));
}

type Persistable = {
  persist: {
    rehydrate: () => Promise<void> | void;
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
  };
};

const registry = new Set<Persistable>();

/**
 * UI-bound persisted stores start from their defaults on both the server and the first client render (so markup
 * matches) and are filled from storage once mounted. Register them here; `<StoreHydrator />` does the rest.
 */
export function registerPersisted(store: Persistable): void {
  registry.add(store);
}

export function rehydrateAll(): void {
  for (const store of registry) void store.persist.rehydrate();
}

/** False on the server and on the first client render; true once the store has been filled from storage. */
export function useStoreHydrated(store: Persistable): boolean {
  return useSyncExternalStore(
    (notify) => store.persist.onFinishHydration(notify),
    () => store.persist.hasHydrated(),
    () => false,
  );
}
