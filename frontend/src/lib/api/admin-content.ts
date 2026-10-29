import { apiFetch, type RequestOptions } from "./client";

type Init = Pick<RequestOptions, "signal">;

export type ContentType = "announcement" | "banner" | "page" | "featured_products" | "story" | "tile" | "flash" | "home_layout";
export type ContentStatus = "draft" | "published" | "archived";
export type Tone = "pink" | "blush" | "plum" | "white";
export type SectionType = "stories" | "hero" | "flash" | "quiz" | "products" | "length" | "tiles" | "ugc" | "trust";

export type ContentEntry = {
  id: string;
  contentType: ContentType;
  slug: string;
  title: string;
  body: Record<string, unknown>;
  status: ContentStatus;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  updatedAt: string | null;
  /** The picture on a hero card, story circle or tile, with a URL to show it. */
  image: { objectKey: string; url: string | null } | null;
};

export type ContentInput = { contentType: ContentType; title: string; body: Record<string, unknown>; status?: ContentStatus; startsAt?: string | null; endsAt?: string | null; sortOrder?: number; slug?: string };
export type ContentPatch = Partial<Omit<ContentInput, "contentType">>;

export type LayoutSection = { type: SectionType; enabled: boolean };

/** Every entry of a type: these are small, hand-curated lists that are edited whole, so all pages are read rather than a first page. */
export async function listContent(query: { type?: ContentType; status?: ContentStatus }, init: Init = {}): Promise<ContentEntry[]> {
  const entries: ContentEntry[] = [];
  let cursor: string | undefined;
  do {
    const page: { data: ContentEntry[]; page: { nextCursor: string | null } } = await apiFetch("/admin/content", { query: { limit: 100, ...query, ...(cursor ? { cursor } : {}) }, auth: "admin", ...init });
    entries.push(...page.data);
    cursor = page.page.nextCursor ?? undefined;
  } while (cursor);
  return entries;
}
export const createContent = (input: ContentInput) => apiFetch<ContentEntry>("/admin/content", { method: "POST", body: input, auth: "admin" });
export const updateContent = (id: string, patch: ContentPatch) => apiFetch<ContentEntry>(`/admin/content/${id}`, { method: "PATCH", body: patch, auth: "admin" });

export type ContentUploadIntent = { objectKey: string; upload: { method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string } };
export const createContentUploadIntent = (input: { contentType: string; sizeBytes: number }) => apiFetch<ContentUploadIntent>("/admin/media/content-upload-intents", { method: "POST", body: input, auth: "admin" });
