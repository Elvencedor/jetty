"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useUnsavedGuard } from "@/lib/admin/useUnsavedGuard";
import { ConfirmDialog } from "./ConfirmDialog";
import { Toaster } from "./Toaster";

type Props = {
  open: boolean;
  /** Called when the modal should close: the parent clears its URL parameter. */
  onClose: () => void;
  title: string;
  /** Pinned under the title bar and never scrolls: a summary of what is being edited, and its tabs. */
  toolbar?: ReactNode;
  /** True while the form inside has changes that are not saved: every way of closing then asks first. */
  dirty?: boolean;
  children: ReactNode;
  /** The action bar. It is pinned to the bottom of the screen, so it stays put however long the content is. */
  footer?: ReactNode;
};

/**
 * A full-screen editor for work that needs room (a product with its options and variants). A native `<dialog>`, so focus is
 * trapped and returns to what opened it and Esc closes. It has three bands: the title bar and an optional toolbar at the top,
 * the content in the middle (the only part that scrolls), and the action bar at the bottom, which is part of the screen, not
 * of the content. Pair with `useUrlState` so the open editor is part of the address. With `dirty` set, the X, Esc and any
 * Cancel that calls `onRequestClose` ask whether to discard first.
 */
export function FullScreenModal({ open, onClose, title, toolbar, dirty = false, children, footer }: Props) {
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
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-surface p-0 text-ink backdrop:bg-scrim open:animate-sheet-in"
      >
        {open ? (
          <div className="flex h-dvh flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft py-2 pl-[18px] pr-2">
              <h2 id={titleId} className="truncate text-label font-bold text-muted">{title}</h2>
              <button type="button" aria-label="Close" onClick={requestClose} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-tint hover:bg-surface-blush"><X aria-hidden="true" size={18} /></button>
            </header>
            {toolbar ? <div className="shrink-0 border-b border-line-soft">{toolbar}</div> : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            <Toaster label="Editor notifications" />
            {footer ? <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-[clamp(16px,3vw,36px)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer> : null}
          </div>
        ) : null}
      </dialog>
      <ConfirmDialog open={asking} title="Discard your changes?" confirmLabel="Discard changes" tone="danger" cancelLabel="Keep editing" onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); onClose(); }}>
        You have changes that haven&apos;t been saved. If you close now, they&apos;ll be lost.
      </ConfirmDialog>
    </>
  );
}
