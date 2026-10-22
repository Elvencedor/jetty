"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { useToasts, type Toast, type ToastTone } from "@/lib/stores/toast";

const DURATION_MS = 5000;
const ICON: Record<ToastTone, typeof Info> = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONE: Record<ToastTone, string> = { success: "bg-success-bg text-success", error: "bg-danger-bg text-danger", info: "bg-info-bg text-info" };

function Item({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  // Errors stay longer: they are the ones worth reading twice.
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), toast.tone === "error" ? DURATION_MS * 2 : DURATION_MS);
    return () => clearTimeout(id);
  }, [toast.id, toast.tone, dismiss]);
  const Icon = ICON[toast.tone];
  return (
    <li role={toast.tone === "error" ? "alert" : "status"} className={cn("pointer-events-auto flex items-start gap-3 rounded-lg border border-line px-4 py-3 text-body-sm font-semibold shadow-panel", TONE[toast.tone])}>
      <Icon aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
      <span className="flex-1">{toast.message}</span>
      {toast.action ? <button type="button" onClick={() => { toast.action!.onClick(); dismiss(toast.id); }} className="shrink-0 underline">{toast.action.label}</button> : null}
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(toast.id)} className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-black/5"><X aria-hidden="true" size={14} /></button>
    </li>
  );
}

/**
 * Where toasts appear: bottom right on wide screens, bottom edge on phones. The admin layout has one, and each open
 * drawer carries its own: while a modal dialog is open everything outside it is inert (unreadable to assistive
 * technology and hidden behind the backdrop), so a message about what you just did in the drawer has to live inside it.
 */
export function Toaster({ label = "Notifications" }: { label?: string } = {}) {
  const toasts = useToasts((s) => s.toasts);
  return (
    <section aria-label={label} className="pointer-events-none fixed inset-x-3 bottom-3 z-50 sm:left-auto sm:w-96">
      {toasts.length ? <ul className="flex flex-col gap-2">{toasts.map((t) => <Item key={t.id} toast={t} />)}</ul> : null}
    </section>
  );
}
