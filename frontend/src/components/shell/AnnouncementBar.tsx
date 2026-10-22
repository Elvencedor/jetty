"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/api/types";

const ROTATE_MS = 5000;

/** A slim banner above the header. With several messages it rotates, and stops while hovered or focused. */
export function AnnouncementBar({ items }: { items: Announcement[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (items.length < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [items.length, paused]);

  const current = items[index % Math.max(items.length, 1)];
  if (!current) return null;
  const safeLink = current.linkUrl && /^\/(?!\/)/.test(current.linkUrl) ? current.linkUrl : undefined;
  return (
    <div
      role="region"
      aria-label="Announcements"
      className="bg-surface-inverse text-on-inverse"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p aria-live={paused ? "polite" : "off"} className="mx-auto flex h-9 max-w-store items-center justify-center gap-2 px-4 text-center text-caption font-semibold">
        <span>{current.text}</span>
        {safeLink ? (
          <Link href={safeLink} className="underline underline-offset-2">
            {current.linkLabel ?? "Shop now"}
          </Link>
        ) : null}
      </p>
    </div>
  );
}
