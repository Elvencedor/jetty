import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PaymentMethod, PaymentStart } from "@/lib/api/types";
import { browserStorage, registerPersisted } from "./persisted";

/** The payment in progress, kept for the tab so a reload can pick up the same Paystack session instead of losing it. */
export type PendingPayment = Pick<PaymentStart, "orderId" | "orderNumber" | "reference" | "accessCode" | "amountMinor" | "reservationExpiresAt"> & {
  method: PaymentMethod;
  /** The total the shopper saw on the review step; if the server's differs they must confirm the new amount. */
  quotedMinor: number;
};

type State = { payment: PendingPayment | null; set: (payment: PendingPayment | null) => void };

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 500;

export const usePaymentSession = create<State>()(
  persist(
    (set) => ({ payment: null, set: (payment) => set({ payment }) }),
    {
      name: "jh.payment.v1",
      version: 1,
      storage: browserStorage("session"),
      partialize: ({ payment }) => ({ payment }),
      skipHydration: true,
      merge: (persisted, current) => {
        const p = (persisted as { payment?: Partial<PendingPayment> | null } | null)?.payment;
        const ok = p && isString(p.orderId) && isString(p.orderNumber) && isString(p.reference) && isString(p.accessCode) && isString(p.reservationExpiresAt) && Number.isInteger(p.amountMinor) && Number.isInteger(p.quotedMinor) && (p.method === "card" || p.method === "bank_transfer");
        return ok ? { ...current, payment: p as PendingPayment } : current;
      },
    },
  ),
);

registerPersisted(usePaymentSession);
