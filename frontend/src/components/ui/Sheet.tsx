"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * A modal panel on the browser's native `<dialog>`: a bottom sheet below 768px and a right-hand drawer from there up.
 * The browser traps focus, closes on Escape, makes the rest of the page inert and returns focus to the opener.
 * Its content is only rendered while open, so it starts fresh each time.
 */
export function Sheet({ open, onClose, title, children, footer, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself, not on its content.
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        "m-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-hidden rounded-t-xl bg-surface p-0 text-ink shadow-drawer backdrop:bg-scrim open:animate-sheet-in open:backdrop:animate-scrim-in",
        "md:ml-auto md:mt-0 md:h-dvh md:max-h-none md:w-[420px] md:rounded-none md:rounded-l-xl md:open:animate-drawer-in",
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[88dvh] flex-col md:h-dvh md:max-h-none">
          <div aria-hidden="true" className="mx-auto mt-2 h-[5px] w-10 rounded-full bg-line-strong md:hidden" />
          <header className="flex items-center justify-between gap-3 px-5 py-3">
            <h2 id={titleId} className="font-display text-heading-sm font-extrabold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-11 items-center justify-center rounded-full bg-surface-tint hover:bg-surface-blush">
              <X aria-hidden="true" size={20} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
          {footer ? <footer className="flex gap-3 border-t border-line bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
