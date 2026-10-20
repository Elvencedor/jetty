import { create } from "zustand";
import { persist } from "zustand/middleware";
import { browserStorage } from "./persisted";

/**
 * Whether this browser has had a signed-in session. It is only a hint (never a credential): it lets a first-time
 * visitor skip a refresh request that would certainly be rejected. The refresh cookie remains the only proof.
 */
type Hints = { customer: boolean; admin: boolean; set: (kind: "customer" | "admin", value: boolean) => void };

export const useSessionHints = create<Hints>()(
  persist(
    (set) => ({ customer: false, admin: false, set: (kind, value) => set({ [kind]: value }) }),
    { name: "jh.session-hints.v1", version: 1, storage: browserStorage("local"), partialize: ({ customer, admin }) => ({ customer, admin }) },
  ),
);
