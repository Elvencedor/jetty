"use client";

import { Search } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BackLink } from "@/components/shell/BackLink";
import { isOptimisable, Media } from "@/components/ui";
import type { ProductMedia } from "@/lib/api/types";
import { cn } from "@/lib/cn";

const label = (angle: string) => angle.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

type Props = {
  media: ProductMedia[];
  title: string;
  /** Scrolls to a photo, for example the one tied to the chosen variant. */
  focusId?: string | null;
  /** The buttons floating at the top right (share, save). */
  actions: ReactNode;
};

/**
 * The full-bleed photo area: swipeable photos (native scroll-snap), floating back, share and save buttons, a chip per
 * camera angle along the bottom, and a full-screen zoom. The content sheet below overlaps its last 32px.
 */
export function Gallery({ media, title, focusId, actions }: Props) {
  const images = media.filter((m) => m.mediaType === "image");
  const stripId = useId();
  const zoom = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  const goTo = (i: number) => {
    const el = document.getElementById(stripId);
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  useEffect(() => {
    const i = images.findIndex((m) => m.id === focusId);
    if (i >= 0) goTo(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
  useEffect(() => {
    const dialog = zoom.current;
    if (!dialog) return;
    if (zoomed && !dialog.open) dialog.showModal();
    if (!zoomed && dialog.open) dialog.close();
  }, [zoomed]);

  const angles = [...new Map(images.filter((m) => m.angle).map((m) => [m.angle!, images.indexOf(m)])).entries()];
  const current = images[Math.min(index, images.length - 1)];

  return (
    <section aria-label="Product images" className="relative h-[500px] bg-pink-300 lg:h-auto lg:aspect-[4/5] lg:overflow-hidden lg:rounded-xl">
      {images.length ? (
        <div
          id={stripId}
          tabIndex={0}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${title} photos`}
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") goTo(Math.min(index + 1, images.length - 1));
            if (e.key === "ArrowLeft") goTo(Math.max(index - 1, 0));
          }}
          className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
        >
          {images.map((m, i) => (
            <div key={m.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${images.length}`} className="h-full w-full shrink-0 snap-center">
              <Media image={m} alt={m.altText || `${title}${m.angle ? `, ${label(m.angle)} view` : ""}`} aspect="auto" priority={i === 0} sizes="(min-width: 1024px) 50vw, 100vw" className="!h-full rounded-none" />
            </div>
          ))}
        </div>
      ) : (
        <div role="img" aria-label={title} className="flex size-full items-center justify-center text-label font-semibold text-primary-deep">Photo coming soon</div>
      )}

      <div className="pointer-events-none absolute inset-x-4 top-3 flex justify-between">
        <BackLink fallback="/shop" className="pointer-events-auto lg:invisible" />
        <div className="pointer-events-auto flex gap-2">{actions}</div>
      </div>

      {images.length ? (
        <div className="absolute inset-x-4 bottom-14 flex gap-1.5 overflow-x-auto lg:bottom-4 [scrollbar-width:none]">
          {angles.length > 1
            ? angles.map(([angle, at]) => (
                <button key={angle} type="button" aria-pressed={current?.angle === angle} onClick={() => goTo(at)} className={cn("h-9 shrink-0 rounded-pill px-3.5 text-label font-bold", current?.angle === angle ? "bg-surface-inverse text-on-inverse" : "bg-surface text-ink")}>
                  {label(angle)}
                </button>
              ))
            : null}
          <button type="button" onClick={() => setZoomed(true)} aria-label="Zoom photo" className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink">
            <Search aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      <dialog ref={zoom} aria-label={`${title}, enlarged`} onClose={() => setZoomed(false)} onClick={(e) => e.target === zoom.current && setZoomed(false)} className="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-surface-inverse/95">
        {zoomed && current ? (
          <div className="relative flex size-full items-center justify-center">
            {current.url ? <Image src={current.url} alt={current.altText || title} fill sizes="100vw" unoptimized={!isOptimisable(current.url)} className="object-contain" /> : null}
            <button type="button" onClick={() => setZoomed(false)} autoFocus className="absolute right-3 top-3 inline-flex h-11 items-center rounded-pill bg-surface px-5 text-body-sm font-semibold">Close</button>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
