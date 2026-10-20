import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DeliveryMethod, PaymentMethod } from "@/lib/api/types";
import { emptyDelivery, type DeliveryDetails } from "@/lib/checkout/validation";
import type { Submission } from "@/lib/checkout/request";
import { browserStorage, registerPersisted } from "./persisted";

/**
 * What the shopper has typed so far, kept for the tab's lifetime (sessionStorage) so a reload mid-checkout loses
 * nothing and nothing outlives the visit. It holds contact details, so it is cleared once an order is placed.
 */
type DraftState = {
  details: DeliveryDetails;
  deliveryMethod: DeliveryMethod | null;
  paymentMethod: PaymentMethod | null;
  /** The key used for the last submission, reused for an identical retry. */
  submission: Submission | null;
  setDetails: (patch: Partial<DeliveryDetails>) => void;
  setDeliveryMethod: (method: DeliveryMethod | null) => void;
  setPaymentMethod: (method: PaymentMethod | null) => void;
  setSubmission: (submission: Submission | null) => void;
  reset: () => void;
};

const METHODS: DeliveryMethod[] = ["same_day", "next_day", "nationwide", "pickup"];
const PAYMENTS: PaymentMethod[] = ["card", "bank_transfer"];

export const useCheckoutDraft = create<DraftState>()(
  persist(
    (set) => ({
      details: emptyDelivery(),
      deliveryMethod: null,
      paymentMethod: null,
      submission: null,
      setDetails: (patch) => set(({ details }) => ({ details: { ...details, ...patch } })),
      setDeliveryMethod: (deliveryMethod) => set({ deliveryMethod }),
      setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
      setSubmission: (submission) => set({ submission }),
      reset: () => set({ details: emptyDelivery(), deliveryMethod: null, paymentMethod: null, submission: null }),
    }),
    {
      name: "jh.checkout-draft.v1",
      version: 1,
      storage: browserStorage("session"),
      partialize: ({ details, deliveryMethod, paymentMethod, submission }) => ({ details, deliveryMethod, paymentMethod, submission }),
      skipHydration: true,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<DraftState, "details" | "deliveryMethod" | "paymentMethod" | "submission">>;
        const base = emptyDelivery();
        // Only known string fields of the right type survive.
        const details = Object.fromEntries(Object.keys(base).map((k) => [k, typeof (p.details as Record<string, unknown> | undefined)?.[k] === "string" ? (p.details as Record<string, string>)[k] : ""])) as DeliveryDetails;
        const sub = p.submission;
        return {
          ...current,
          details,
          deliveryMethod: METHODS.includes(p.deliveryMethod as DeliveryMethod) ? (p.deliveryMethod as DeliveryMethod) : null,
          paymentMethod: PAYMENTS.includes(p.paymentMethod as PaymentMethod) ? (p.paymentMethod as PaymentMethod) : null,
          submission: sub && typeof sub.key === "string" && typeof sub.fingerprint === "string" ? { key: sub.key, fingerprint: sub.fingerprint } : null,
        };
      },
    },
  ),
);

registerPersisted(useCheckoutDraft);
