import Image from "next/image";
import { cn } from "@/lib/cn";

export type MediaSource = { url: string | null; width?: number | null; height?: number | null };

/** Image placeholder tones, used until photography exists or when an image has no URL. */
const TONES = ["bg-photo-1", "bg-photo-2", "bg-photo-3", "bg-photo-4", "bg-photo-5"] as const;

type Props = {
  image: MediaSource | null | undefined;
  /** Describe the picture, or pass "" when it is decorative. */
  alt: string;
  /** CSS aspect ratio of the box, e.g. "4 / 5" or "1 / 1.25". Reserved up front so nothing shifts when it loads. */
  aspect?: string;
  /** `sizes` for the responsive srcset, e.g. "(min-width: 1024px) 25vw, 50vw". */
  sizes?: string;
  /** Mark the largest image above the fold, and only that one. */
  priority?: boolean;
  /** Which placeholder tone to show without an image (0–4); also used to vary neighbouring cards. */
  tone?: number;
  caption?: string;
  className?: string;
};

/**
 * Optimised image through `next/image`, cropped with `object-cover`, in a box whose shape is fixed in advance.
 * Only the configured media host (the CDN) goes through Next's optimiser; any other URL is served as it is.
 */
export function Media({ image, alt, aspect = "4 / 5", sizes, priority = false, tone = 0, caption, className }: Props) {
  // Callers may set their own corner radius; otherwise images use the standard 20px.
  const box = cn("relative overflow-hidden", !/(^|\s)rounded(-|\s|$)/.test(className ?? "") && "rounded-lg", className);
  if (!image?.url) {
    return (
      <div className={cn(box, TONES[Math.abs(tone) % TONES.length], "flex items-end p-3")} style={{ aspectRatio: aspect }} role={alt ? "img" : undefined} aria-label={alt || undefined}>
        {caption ? <span className="text-caption font-semibold text-primary-deep">{caption}</span> : null}
      </div>
    );
  }
  return (
    <div className={box} style={{ aspectRatio: aspect }}>
      <Image src={image.url} alt={alt} fill sizes={sizes ?? "100vw"} priority={priority} unoptimized={!isOptimisable(image.url)} className="object-cover" />
    </div>
  );
}

/** True for URLs on the CDN host configured at build time (`NEXT_PUBLIC_MEDIA_HOST`). */
export function isOptimisable(url: string): boolean {
  const host = process.env.NEXT_PUBLIC_MEDIA_HOST;
  if (!host) return false;
  try {
    return new URL(url).host === host;
  } catch {
    return false;
  }
}
