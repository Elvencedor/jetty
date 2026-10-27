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

export const listContent = (query: { type?: ContentType; status?: ContentStatus; limit?: number }, init: Init = {}) =>
  apiFetch<{ data: ContentEntry[]; page: { nextCursor: string | null } }>("/admin/content", { query: { limit: 100, ...query }, auth: "admin", ...init }).then((r) => r.data);
export const createContent = (input: ContentInput) => apiFetch<ContentEntry>("/admin/content", { method: "POST", body: input, auth: "admin" });
export const updateContent = (id: string, patch: ContentPatch) => apiFetch<ContentEntry>(`/admin/content/${id}`, { method: "PATCH", body: patch, auth: "admin" });

export type ContentUploadIntent = { objectKey: string; upload: { method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string } };
export const createContentUploadIntent = (input: { contentType: string; sizeBytes: number }) => apiFetch<ContentUploadIntent>("/admin/media/content-upload-intents", { method: "POST", body: input, auth: "admin" });
