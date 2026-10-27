"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useUnsavedGuard } from "@/lib/admin/useUnsavedGuard";
import { ConfirmDialog } from "./ConfirmDialog";
import { Toaster } from "./Toaster";

type Props = {
  open: boolean;
  /** Called when the drawer should close: the parent clears its URL parameter. */
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** A small muted title ("Edit product") when the content brings its own heading. */
  compactTitle?: boolean;
  /** True while the form inside has changes that are not saved: closing then asks first. */
  dirty?: boolean;
  children: ReactNode;
  /** A bar pinned to the bottom (Save, Cancel). */
  footer?: ReactNode;
};

/**
 * Detail view that slides in from the right (full-screen on phones, 480px otherwise) over a list that stays in place
 * underneath. Native `<dialog>`: focus is trapped and returns to what opened it, Esc closes, and the height follows the
 * visible screen (`dvh`). Pair with `useUrlState("order")` so the open drawer is part of the address.
 * With `dirty` set, every way of closing (X, Esc, the scrim) first asks whether to discard.
 */
export function SideDrawer({ open, onClose, title, subtitle, compactTitle = false, dirty = false, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [asking, setAsking] = useState(false);
  useUnsavedGuard(open && dirty);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const requestClose = () => (dirty ? setAsking(true) : onClose());

  return (
    <>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        // Esc: stop the browser closing it behind our back, and go through the same path as the X.
        onCancel={(e) => { e.preventDefault(); requestClose(); }}
        onClose={() => open && onClose()}
        // A click on the scrim lands on the dialog element itself, not on its content.
        onClick={(e) => e.target === ref.current && requestClose()}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-none overflow-hidden bg-surface p-0 text-ink shadow-drawer backdrop:bg-scrim open:animate-drawer-in sm:w-[480px]"
      >
        {open ? (
          <div className="flex h-dvh flex-col">
            <header className={compactTitle ? "flex items-center justify-between gap-3 border-b border-line-soft py-2 pl-[18px] pr-2" : "flex items-start justify-between gap-3 border-b border-line px-5 py-4"}>
              <div className="min-w-0">
                <h2 id={titleId} className={compactTitle ? "truncate text-label font-bold text-muted" : "truncate font-display text-heading-sm font-extrabold"}>{title}</h2>
                {subtitle ? <p className="text-body-sm text-muted">{subtitle}</p> : null}
              </div>
              <button type="button" aria-label="Close" onClick={requestClose} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-tint hover:bg-surface-blush"><X aria-hidden="true" size={18} /></button>
            </header>
            <div className={compactTitle ? "min-h-0 flex-1 overflow-y-auto overscroll-contain" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"}>{children}</div>
            <Toaster label="Drawer notifications" />
            {footer ? <footer className="flex justify-end gap-2 border-t border-line bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer> : null}
          </div>
        ) : null}
      </dialog>
      <ConfirmDialog open={asking} title="Discard your changes?" confirmLabel="Discard changes" tone="danger" cancelLabel="Keep editing" onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); onClose(); }}>
        You have changes that haven&apos;t been saved. If you close now, they&apos;ll be lost.
      </ConfirmDialog>
    </>
  );
}
