import { create } from "zustand";
import { persist } from "zustand/middleware";
import { browserStorage } from "./persisted";

/**
 * Whether the visitor agreed to anonymous usage analytics (Nigeria's data protection rules ask for a real choice).
 * `unset` means they have not chosen yet, and until they do nothing is sent. Essential storage (the bag, the sign-in
 * hint) is not covered by this: the shop cannot work without it.
 *
 * Unlike the other persisted stores this one hydrates straight away: analytics events fire from effects that run
 * before the app-wide hydration pass, and they must see the saved choice.
 */
export type AnalyticsConsent = "unset" | "granted" | "denied";

type State = { analytics: AnalyticsConsent; choose: (value: "granted" | "denied") => void; reset: () => void };

export const useConsent = create<State>()(
  persist(
    (set) => ({ analytics: "unset", choose: (analytics) => set({ analytics }), reset: () => set({ analytics: "unset" }) }),
    {
      name: "jh.consent.v1",
      version: 1,
      storage: browserStorage("local"),
      partialize: ({ analytics }) => ({ analytics }),
      merge: (persisted, current) => {
        const value = (persisted as { analytics?: unknown } | null)?.analytics;
        return value === "granted" || value === "denied" ? { ...current, analytics: value } : current;
      },
    },
  ),
);

/** True only when the visitor has said yes. */
export const analyticsAllowed = () => useConsent.getState().analytics === "granted";
