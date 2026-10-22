import type { StatusTone } from "@/components/ui/StatusPill";
import type { SegmentKey } from "@/lib/api/admin-customers";

export const SEGMENT_KEYS: readonly SegmentKey[] = ["vip", "new", "returning", "lapsed"];
export const segmentFromParam = (v: string | null): SegmentKey | null => SEGMENT_KEYS.find((k) => k === v) ?? null;

/** The tag a segment wears in the table. */
export const SEGMENT_TAG: Record<SegmentKey, { label: string; tone: StatusTone }> = {
  vip: { label: "VIP", tone: "primary" },
  new: { label: "New", tone: "info" },
  returning: { label: "Returning", tone: "success" },
  lapsed: { label: "Lapsed", tone: "warning" },
};

type Who = { name: string | null; email: string | null; phone: string | null };

/** The name if the customer has given one, else the contact they signed up with. */
export const displayName = (c: Who) => c.name?.trim() || c.email || c.phone || "Customer";

/** Up to two letters for the avatar: "Adaeze Okafor" → "AO", "tolu@example.com" → "T". */
export function initials(c: Who): string {
  const name = c.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return (words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : words[0]!.slice(0, 2)).toUpperCase();
  }
  const first = (c.email ?? c.phone ?? "?").replace(/^\+/, "")[0]!;
  return first.toUpperCase();
}

/** A steady pick among the five photo tones, so a customer always has the same colour. */
export function avatarTone(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 5;
}

export const PHOTO_BG = ["bg-photo-1", "bg-photo-2", "bg-photo-3", "bg-photo-4", "bg-photo-5"] as const;

/** "Lekki, Lagos", or whichever half there is. */
export const placeOf = (c: { area: string | null; state: string | null }) => [c.area, c.state].filter((p): p is string => !!p).join(", ");

/** The average over paid orders, in kobo. */
export const averageOrder = (orderCount: number, lifetimeMinor: number) => (orderCount > 0 ? Math.round(lifetimeMinor / orderCount) : 0);

/** "Mar 2026" in Lagos time. */
export const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Africa/Lagos" });
