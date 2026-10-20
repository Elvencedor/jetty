"use client";

import { Expand } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { isOptimisable, Media } from "@/components/ui";
import type { ProductMedia } from "@/lib/api/types";
import { cn } from "@/lib/cn";

const label = (angle: string) => angle.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * Photos in a swipeable strip (native scroll-snap), with a chip per camera angle and a full-screen zoom.
 * `focusId` scrolls to a photo, for example the one tied to the chosen variant.
 */
export function Gallery({ media, title, focusId }: { media: ProductMedia[]; title: string; focusId?: string | null }) {
  const images = media.filter((m) => m.mediaType === "image");
  const strip = useRef<HTMLDivElement>(null);
  const zoom = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  const goTo = (i: number) => {
    const el = strip.current;
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

  if (!images.length) return <Media image={null} alt={title} aspect="4 / 5" />;

  const angles = [...new Map(images.filter((m) => m.angle).map((m) => [m.angle!, images.indexOf(m)])).entries()];
  const current = images[Math.min(index, images.length - 1)]!;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div
          ref={strip}
          tabIndex={0}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${title} photos`}
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") goTo(Math.min(index + 1, images.length - 1));
            if (e.key === "ArrowLeft") goTo(Math.max(index - 1, 0));
          }}
          className="flex snap-x snap-mandatory overflow-x-auto rounded-xl [scrollbar-width:none]"
        >
          {images.map((m, i) => (
            <div key={m.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${images.length}`} className="w-full shrink-0 snap-center">
              <Media image={m} alt={m.altText || `${title}${m.angle ? `, ${label(m.angle)} view` : ""}`} aspect="4 / 5" priority={i === 0} sizes="(min-width: 1024px) 50vw, 100vw" className="rounded-none" />
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setZoomed(true)} aria-label="Zoom photo" className="absolute right-3 top-3 inline-flex size-11 items-center justify-center rounded-full bg-white shadow-sm">
          <Expand aria-hidden="true" size={18} />
        </button>
        {images.length > 1 ? (
          <p aria-hidden="true" className="absolute bottom-3 right-3 rounded-pill bg-surface-inverse/80 px-2.5 py-1 text-caption font-semibold text-on-inverse">{index + 1}/{images.length}</p>
        ) : null}
      </div>

      {angles.length > 1 ? (
        <div role="group" aria-label="Photo angle" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {angles.map(([angle, at]) => (
            <button key={angle} type="button" aria-pressed={current.angle === angle} onClick={() => goTo(at)} className={cn("min-h-9 shrink-0 rounded-pill px-4 text-label font-semibold", current.angle === angle ? "bg-primary text-on-primary" : "bg-surface-tint text-ink")}>
              {label(angle)}
            </button>
          ))}
        </div>
      ) : null}

      <dialog ref={zoom} aria-label={`${title}, enlarged`} onClose={() => setZoomed(false)} onClick={(e) => e.target === zoom.current && setZoomed(false)} className="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-surface-inverse/95">
        {zoomed ? (
          <div className="relative flex size-full items-center justify-center">
            {current.url ? <Image src={current.url} alt={current.altText || title} fill sizes="100vw" unoptimized={!isOptimisable(current.url)} className="object-contain" /> : null}
            <button type="button" onClick={() => setZoomed(false)} autoFocus className="absolute right-3 top-3 inline-flex h-11 items-center rounded-pill bg-white px-5 text-body-sm font-semibold">Close</button>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
