import { apiRequest, apiFetch, type RequestOptions } from "./client";

type Init = Pick<RequestOptions, "signal">;

export type AdminProductStatus = "draft" | "active" | "archived";

/** One product as the list shows it. */
export type AdminProductRow = {
  id: string;
  slug: string;
  title: string;
  status: AdminProductStatus;
  featured: boolean;
  publishedAt: string | null;
  updatedAt: string;
  variantCount: number;
  availableQuantity: number;
  lowStock: boolean;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  coverUrl: string | null;
};

export type AdminProductPage = {
  /** Whole-catalogue figures for the page header; only on the first page. */
  summary: { products: number; variants: number; lowStock: number } | null;
  data: AdminProductRow[];
  page: { nextCursor: string | null };
};

export type AdminOptionValue = { id: string; label: string; valueKey: string; priceDeltaMinor: number; swatch: string | null; active: boolean };
export type AdminOption = { id: string; name: string; values: AdminOptionValue[] };
export type AdminVariant = {
  id: string;
  sku: string;
  /** Option name → the chosen value's key. */
  optionValues: Record<string, string>;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  active: boolean;
  stock: { onHand: number; reserved: number; available: number; lowStockThreshold: number | null };
};
export type AdminMedia = { id: string; objectKey: string; url: string | null; altText: string | null; angle: string | null; isCover: boolean; sortOrder: number; width: number | null; height: number | null; variantId: string | null; mediaType: string };

export type AdminProductDetail = {
  product: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    status: AdminProductStatus;
    featured: boolean;
    badgeOverride: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    details: { details?: string; fit?: string; care?: string; delivery?: string } | null;
    categoryIds: string[];
    collectionIds: string[];
    updatedAt: string;
  };
  options: AdminOption[];
  variants: AdminVariant[];
  media: AdminMedia[];
};

/** A product with the ETag the next edit must send (`If-Match`). */
export type Versioned<T> = { data: T; etag: string | null };

export type ProductFields = Partial<{
  title: string;
  description: string | null;
  featured: boolean;
  badgeOverride: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  details: { details?: string; fit?: string; care?: string; delivery?: string };
  categoryIds: string[];
  slug: string;
}>;

/** What `PUT /admin/products/{id}/variants` takes. */
export type MatrixPayload = {
  options: { name: string; values: { label: string; valueKey: string; priceDeltaMinor: number; active: boolean; swatch: string | null }[] }[];
  variants: { id?: string; sku: string; optionValues: Record<string, string>; priceMinor: number; compareAtPriceMinor: number | null; active: boolean; stock?: number }[];
};

export const listAdminProducts = (params: { q?: string; status?: AdminProductStatus; stock?: "out" | "low"; limit?: number; cursor?: string }, init: Init = {}) =>
  apiFetch<AdminProductPage>("/admin/products", { query: params, auth: "admin", ...init });

async function versioned<T>(path: string, options: RequestOptions): Promise<Versioned<T>> {
  const res = await apiRequest<T>(path, { auth: "admin", ...options });
  return { data: res.data, etag: res.etag };
}

export const getAdminProduct = (id: string, init: Init = {}) => versioned<AdminProductDetail>(`/admin/products/${id}`, init);
export const createAdminProduct = (title: string) => versioned<AdminProductDetail>("/admin/products", { method: "POST", body: { title } });
export const updateAdminProduct = (id: string, etag: string | null, fields: ProductFields) => versioned<AdminProductDetail>(`/admin/products/${id}`, { method: "PATCH", body: fields, ...(etag ? { ifMatch: etag } : {}) });
export const setAdminProductStatus = (id: string, action: "publish" | "archive") => versioned<AdminProductDetail>(`/admin/products/${id}/${action}`, { method: "POST", body: {} });
export const putMatrix = (id: string, etag: string | null, matrix: MatrixPayload) => versioned<AdminProductDetail>(`/admin/products/${id}/variants`, { method: "PUT", body: matrix, ...(etag ? { ifMatch: etag } : {}) });

export type AdminCategory = { id: string; name: string; slug: string; parentId: string | null; active: boolean };
export const listAdminCategories = (init: Init = {}) => apiFetch<{ data: AdminCategory[] }>("/admin/categories", { auth: "admin", ...init }).then((r) => r.data);

/** Why stock changed, as the ledger records it. The product screens use "correction" for hand edits. */
export type StockReason = "restock" | "correction" | "damaged" | "returned" | "stock_count";
export const adjustStock = (variantId: string, change: { mode: "adjust" | "set"; quantity: number; reason: StockReason; lowStockThreshold?: number | null }) =>
  apiFetch<{ variantId: string; onHand: number; reserved: number; available: number; lowStockThreshold: number | null }>(`/admin/inventory/${variantId}`, { method: "PATCH", body: change, auth: "admin" });

export type UploadIntent = { objectKey: string; upload: { method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string } };
export const createUploadIntent = (input: { productId: string; contentType: string; sizeBytes: number }) => apiFetch<UploadIntent>("/admin/media/upload-intents", { method: "POST", body: input, auth: "admin" });
export const attachMedia = (productId: string, body: { objectKey: string; width?: number | null; height?: number | null; altText?: string | null; angle?: string | null }) =>
  apiFetch<AdminMedia>(`/admin/products/${productId}/media`, { method: "POST", body, auth: "admin" });
export const updateMedia = (productId: string, mediaId: string, body: Partial<{ altText: string | null; angle: string | null; isCover: boolean; sortOrder: number }>) =>
  apiFetch<AdminMedia>(`/admin/products/${productId}/media/${mediaId}`, { method: "PATCH", body, auth: "admin" });
export const deleteMedia = (productId: string, mediaId: string) => apiFetch<null>(`/admin/products/${productId}/media/${mediaId}`, { method: "DELETE", auth: "admin" });

export const MEDIA_ANGLES = ["front", "side", "back", "hairline", "worn", "scale", "detail"] as const;

// ---------------------------------------------------------- categories and collections

export type CategoryRow = AdminCategory & { sortOrder: number; productCount: number };
export type CollectionRow = Collection & { description: string | null; sortOrder: number; productCount: number };
export type Collection = { id: string; name: string; slug: string; active: boolean };
export type TaxonomyFields = { name: string; slug: string; sortOrder: number; active: boolean };

export const listAdminCategoryRows = (init: Init = {}) => apiFetch<{ data: CategoryRow[] }>("/admin/categories", { auth: "admin", ...init }).then((r) => r.data);
export const createAdminCategory = (body: Partial<TaxonomyFields> & { name: string; parentId?: string | null }) => apiFetch<CategoryRow>("/admin/categories", { method: "POST", body, auth: "admin" });
export const updateAdminCategory = (id: string, body: Partial<TaxonomyFields> & { parentId?: string | null }) => apiFetch<CategoryRow>(`/admin/categories/${id}`, { method: "PATCH", body, auth: "admin" });

export const listAdminCollectionRows = (init: Init = {}) => apiFetch<{ data: CollectionRow[] }>("/admin/collections", { auth: "admin", ...init }).then((r) => r.data);
export const createAdminCollection = (body: Partial<TaxonomyFields> & { name: string; description?: string | null }) => apiFetch<CollectionRow>("/admin/collections", { method: "POST", body, auth: "admin" });
export const updateAdminCollection = (id: string, body: Partial<TaxonomyFields> & { description?: string | null }) => apiFetch<CollectionRow>(`/admin/collections/${id}`, { method: "PATCH", body, auth: "admin" });
export const listCollectionMembers = (id: string, init: Init = {}) => apiFetch<{ data: { id: string; title: string; status: string }[] }>(`/admin/collections/${id}/products`, { auth: "admin", ...init }).then((r) => r.data);
export const setCollectionMembers = (id: string, productIds: string[]) => apiFetch<{ productIds: string[] }>(`/admin/collections/${id}/products`, { method: "PUT", body: { productIds }, auth: "admin" });
