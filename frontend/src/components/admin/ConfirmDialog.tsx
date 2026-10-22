"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui";

type Props = {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` styles the confirm button as a destructive action. */
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A question that must be answered before going on: native `<dialog>` (focus is trapped, Esc cancels, the page behind
 * is inert). Focus starts on Cancel, so pressing Enter never confirms something destructive by accident.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "Cancel", tone = "primary", busy = false, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }} onClose={() => open && !busy && onCancel()} className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-card bg-surface p-0 text-ink shadow-panel backdrop:bg-scrim">
      {open ? (
        <div className="flex flex-col gap-3 p-5">
          <h2 id={titleId} className="font-display text-heading-xs font-extrabold">{title}</h2>
          {children ? <div className="text-body-sm text-ink-soft">{children}</div> : null}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" autoFocus disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
            <Button variant={tone === "danger" ? "danger-soft" : "primary"} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
