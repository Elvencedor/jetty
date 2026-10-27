import { create } from "zustand";

export type ToastTone = "success" | "error" | "info";
export type Toast = { id: number; tone: ToastTone; message: string; action?: { label: string; onClick: () => void } };

type State = {
  toasts: Toast[];
  push: (tone: ToastTone, message: string, action?: Toast["action"]) => number;
  dismiss: (id: number) => void;
};

let next = 1;

/** A short list of messages that confirm what just happened (or failed). Each leaves by itself after a few seconds. */
export const useToasts = create<State>()((set) => ({
  toasts: [],
  push: (tone, message, action) => {
    const id = next++;
    // Only the latest few stay, so a burst of failures cannot bury the page.
    set(({ toasts }) => ({ toasts: [...toasts, { id, tone, message, ...(action ? { action } : {}) }].slice(-4) }));
    return id;
  },
  dismiss: (id) => set(({ toasts }) => ({ toasts: toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (message: string, action?: Toast["action"]) => useToasts.getState().push("success", message, action),
  error: (message: string, action?: Toast["action"]) => useToasts.getState().push("error", message, action),
  info: (message: string, action?: Toast["action"]) => useToasts.getState().push("info", message, action),
};
