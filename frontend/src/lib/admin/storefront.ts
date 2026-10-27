import type { ContentEntry, ContentInput, ContentPatch, ContentType, LayoutSection, SectionType, Tone } from "@/lib/api/admin-content";
import { formatDateTime, formatDate } from "@/lib/format";
import { fromLagosInput, toLagosInput } from "./promotions";

// ------------------------------------------------------------------ the sections

export type SectionKind = ContentType | "auto";
export type SectionMeta = { type: SectionType | "announcement"; name: string; help: string; kind: SectionKind; automatic?: string };

/** The blocks of the home page, in the order the shop shows them until the owner changes it. */
export const SECTION_META: Record<SectionType | "announcement", SectionMeta> = {
  announcement: { type: "announcement", name: "Announcement bar", help: "A line across the top of every page. Messages rotate every few seconds.", kind: "announcement" },
  stories: { type: "stories", name: "Story circles", help: "Round shortcuts at the top of the home page.", kind: "story" },
  hero: { type: "hero", name: "Hero cards", help: "The big cards at the top: a headline, a button and a colour.", kind: "banner" },
  flash: { type: "flash", name: "Flash deal strip", help: "A countdown for a promotion that has an end date.", kind: "flash" },
  quiz: { type: "quiz", name: "Wig quiz", help: "Reserved. It shows once the quiz exists.", kind: "auto", automatic: "This block fills itself in when the quiz is ready." },
  products: { type: "products", name: "Jetty's picks", help: "A row of products you choose.", kind: "featured_products" },
  length: { type: "length", name: "Shop by length", help: "Bars that open the shop at a length.", kind: "auto", automatic: "Built from your products' lengths. Nothing to fill in." },
  tiles: { type: "tiles", name: "Category tiles", help: "Pictures that open a part of the shop.", kind: "tile" },
  ugc: { type: "ugc", name: "Customer photos", help: "Reserved. It shows once customer photos exist.", kind: "auto", automatic: "This block fills itself in when customer photos are available." },
  trust: { type: "trust", name: "Trust badges", help: "Delivery, returns and payment reassurance.", kind: "auto", automatic: "Taken from your delivery, returns and payment settings. Nothing to fill in." },
};
export const DEFAULT_ORDER: SectionType[] = ["stories", "hero", "flash", "quiz", "products", "length", "tiles", "ugc", "trust"];

/** The saved layout, with any block it does not mention added at the end, hidden (as the shop does). With no layout, everything shows. */
export function mergeLayout(saved: LayoutSection[] | null): LayoutSection[] {
  if (!saved) return DEFAULT_ORDER.map((type) => ({ type, enabled: true }));
  const known = saved.filter((s) => DEFAULT_ORDER.includes(s.type));
  return [...known, ...DEFAULT_ORDER.filter((t) => !known.some((s) => s.type === t)).map((type) => ({ type, enabled: false }))];
}

export function moveSection(sections: LayoutSection[], index: number, by: -1 | 1): LayoutSection[] {
  const to = index + by;
  if (to < 0 || to >= sections.length) return sections;
  const next = [...sections];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export const toggleSection = (sections: LayoutSection[], index: number): LayoutSection[] => sections.map((s, i) => (i === index ? { ...s, enabled: !s.enabled } : s));

/** "Hero cards moved to position 2 of 9", for the live region and the Undo toast. */
export const moveMessage = (name: string, to: number, total: number) => `${name} moved to position ${to} of ${total}`;

/** "8 of 10 showing". */
export const showingText = (sections: LayoutSection[], announcementOn: boolean) => `${sections.filter((s) => s.enabled).length + (announcementOn ? 1 : 0)} of ${sections.length + 1} showing`;

// ------------------------------------------------------------------ entries

export type StatusLabel = { label: string; tone: "success" | "warning" | "neutral" | "info" };

/** What an entry is doing right now, in words. */
export function entryStatus(e: Pick<ContentEntry, "status" | "startsAt" | "endsAt">, now: Date = new Date()): StatusLabel {
  if (e.status === "archived") return { label: "Archived", tone: "neutral" };
  if (e.status === "draft") return { label: "Draft", tone: "warning" };
  if (e.endsAt && Date.parse(e.endsAt) <= now.getTime()) return { label: `Ended ${formatDate(e.endsAt)}`, tone: "neutral" };
  if (e.startsAt && Date.parse(e.startsAt) > now.getTime()) return { label: `Starts ${formatDateTime(e.startsAt)}`, tone: "info" };
  return { label: "Live", tone: "success" };
}

/** A site path (`/shop`) or an http(s) link; anything else, including `//host`, is refused. */
export const isLinkUrl = (v: string) => /^(https?:\/\/\S+|\/(?![/\\])\S*)$/.test(v.trim());

export type EntryForm = {
  /** The main text: the message, headline, title or heading. */
  main: string;
  secondary: string;
  tag: string;
  tone: Tone;
  linkLabel: string;
  linkUrl: string;
  highlight: boolean;
  promotionId: string;
  startsAt: string;
  endsAt: string;
  /** The uploaded picture (a key the API gave back), a URL to preview it, and what it shows. */
  imageKey: string;
  imageUrl: string;
  imageAlt: string;
};
export const emptyEntry = (): EntryForm => ({ main: "", secondary: "", tag: "", tone: "pink", linkLabel: "", linkUrl: "", highlight: false, promotionId: "", startsAt: "", endsAt: "", imageKey: "", imageUrl: "", imageAlt: "" });

/** The block types that can carry a picture. */
export const IMAGE_TYPES: ContentType[] = ["banner", "story", "tile"];

export const TONES: { value: Tone; label: string }[] = [{ value: "pink", label: "Pink" }, { value: "blush", label: "Blush" }, { value: "plum", label: "Plum" }, { value: "white", label: "White" }];

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function entryToForm(e: ContentEntry): EntryForm {
  const b = e.body;
  const f = emptyEntry();
  f.startsAt = toLagosInput(e.startsAt);
  f.endsAt = toLagosInput(e.endsAt);
  f.imageKey = str(b.imageObjectKey);
  f.imageUrl = e.image?.url ?? "";
  f.imageAlt = str(b.imageAlt);
  switch (e.contentType) {
    case "announcement": return { ...f, main: str(b.text), linkUrl: str(b.linkUrl), linkLabel: str(b.linkLabel) };
    case "banner": return { ...f, main: str(b.headline), secondary: str(b.subheadline), tag: str(b.tag), tone: (b.tone as Tone) ?? "pink", linkLabel: str(b.ctaLabel), linkUrl: str(b.ctaUrl) };
    case "story": return { ...f, main: str(b.title), linkUrl: str(b.linkUrl), highlight: b.highlight === true };
    case "tile": return { ...f, main: str(b.title), secondary: str(b.subtitle), tone: (b.tone as Tone) ?? "pink", linkUrl: str(b.linkUrl) };
    case "flash": return { ...f, main: str(b.headline), promotionId: str(b.promotionId) };
    default: return { ...f, main: e.title };
  }
}

export type EntryErrors = Partial<Record<"main" | "linkUrl" | "linkLabel" | "promotionId" | "endsAt" | "startsAt" | "imageAlt", string>>;

export const MAIN_LIMIT: Partial<Record<ContentType, number>> = { announcement: 200, banner: 160, story: 40, tile: 60, flash: 80 };

export function validateEntry(type: ContentType, f: EntryForm): EntryErrors {
  const e: EntryErrors = {};
  const limit = MAIN_LIMIT[type];
  if (type !== "flash" && !f.main.trim()) e.main = type === "announcement" ? "Write the message" : type === "banner" ? "Write the headline" : "Write the title";
  else if (limit && f.main.trim().length > limit) e.main = `Keep it under ${limit} characters`;
  const linkNeeded = type === "story" || type === "tile";
  if (linkNeeded && !f.linkUrl.trim()) e.linkUrl = "Say where it goes, like /shop";
  else if (f.linkUrl.trim() && !isLinkUrl(f.linkUrl)) e.linkUrl = "Use a link starting with https:// or a path like /shop";
  if (type === "banner" && f.linkLabel.trim() && !f.linkUrl.trim()) e.linkUrl = "Say where the button goes";
  if (type === "banner" && f.linkUrl.trim() && !f.linkLabel.trim()) e.linkLabel = "Say what the button says";
  if (type === "flash" && !f.promotionId) e.promotionId = "Choose a promotion";
  if (f.imageKey && !f.imageAlt.trim()) e.imageAlt = "Describe the picture for people who can't see it";
  if (f.startsAt && !fromLagosInput(f.startsAt)) e.startsAt = "Enter a date and time";
  if (f.endsAt && !fromLagosInput(f.endsAt)) e.endsAt = "Enter a date and time";
  const s = fromLagosInput(f.startsAt);
  const en = fromLagosInput(f.endsAt);
  if (s && en && Date.parse(en) <= Date.parse(s)) e.endsAt = "The end has to be after the start";
  return e;
}

const opt = (v: string) => (v.trim() ? v.trim() : undefined);
const image = (f: EntryForm) => (f.imageKey ? { imageObjectKey: f.imageKey, imageAlt: f.imageAlt.trim() } : {});

/** The API body for the form; empty optional fields are left out so they validate. */
export function entryToPayload(type: ContentType, f: EntryForm): Pick<ContentInput, "title" | "body" | "startsAt" | "endsAt"> {
  const schedule = { startsAt: fromLagosInput(f.startsAt), endsAt: fromLagosInput(f.endsAt) };
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  switch (type) {
    case "announcement": return { title: f.main.trim(), body: clean({ text: f.main.trim(), linkUrl: opt(f.linkUrl), linkLabel: opt(f.linkLabel) }), ...schedule };
    case "banner": return { title: f.main.trim(), body: clean({ headline: f.main.trim(), subheadline: opt(f.secondary), tag: opt(f.tag), tone: f.tone, ctaLabel: opt(f.linkLabel), ctaUrl: opt(f.linkUrl), ...image(f) }), ...schedule };
    case "story": return { title: f.main.trim(), body: clean({ title: f.main.trim(), linkUrl: f.linkUrl.trim(), highlight: f.highlight || undefined, ...image(f) }), ...schedule };
    case "tile": return { title: f.main.trim(), body: clean({ title: f.main.trim(), subtitle: opt(f.secondary), tone: f.tone, linkUrl: f.linkUrl.trim(), ...image(f) }), ...schedule };
    case "flash": return { title: f.main.trim() || "Flash deal", body: clean({ promotionId: f.promotionId, headline: opt(f.main) }), ...schedule };
    default: return { title: f.main.trim(), body: {}, ...schedule };
  }
}

export type EntryPatch = ContentPatch;

/** A sort order for each entry in the list, by its place, so moving one swaps two. */
export const sortOrders = (n: number) => Array.from({ length: n }, (_, i) => i * 10);

export function moveEntry<T extends { id: string }>(items: T[], id: string, by: -1 | 1): T[] {
  const i = items.findIndex((x) => x.id === id);
  const to = i + by;
  if (i < 0 || to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[i], next[to]] = [next[to]!, next[i]!];
  return next;
}

// ------------------------------------------------------------------ products row

export function moveId(ids: string[], id: string, by: -1 | 1): string[] {
  return moveEntry(ids.map((x) => ({ id: x })), id, by).map((x) => x.id);
}
export const FEATURED_LIMIT = 24;
