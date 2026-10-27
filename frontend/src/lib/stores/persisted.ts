import { createJSONStorage } from "zustand/middleware";

/** JSON storage over the browser's localStorage or sessionStorage. Safe on the server and when storage is blocked. */
export function browserStorage<S>(kind: "local" | "session") {
  return createJSONStorage<S>(() => (kind === "local" ? window.localStorage : window.sessionStorage));
}

export type Persistable = {
  persist: {
    rehydrate: () => Promise<void> | void;
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
  };
};

const registry = new Set<Persistable>();
let started = false;

/**
 * UI-bound persisted stores start from their defaults on both the server and the first client render (so markup
 * matches) and are filled from storage once mounted. Register them here; `<StoreHydrator />` does the rest.
 */
export function registerPersisted(store: Persistable): void {
  registry.add(store);
  // A store whose module loads late (code split behind a streamed section) missed the app-wide pass: fill it now.
  if (started) void store.persist.rehydrate();
}

export function rehydrateAll(): void {
  started = true;
  for (const store of registry) void store.persist.rehydrate();
}
