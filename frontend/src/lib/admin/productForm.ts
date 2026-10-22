import type { AdminProductDetail, AdminProductStatus, ProductFields } from "@/lib/api/admin-catalog";

/** The editable text and choices of a product (everything but its options, variants and photos). */
export type Basics = {
  title: string;
  description: string;
  /** One category, as the design has it; empty means none. */
  categoryId: string;
  status: AdminProductStatus;
  seoTitle: string;
  seoDescription: string;
  details: { details: string; fit: string; care: string; delivery: string };
  featured: boolean;
  /** Empty = automatic badges (sale, new, low stock). */
  badge: string;
};

export const basicsFrom = (d: AdminProductDetail): Basics => ({
  title: d.product.title,
  description: d.product.description ?? "",
  categoryId: d.product.categoryIds[0] ?? "",
  status: d.product.status,
  seoTitle: d.product.seoTitle ?? "",
  seoDescription: d.product.seoDescription ?? "",
  details: { details: d.product.details?.details ?? "", fit: d.product.details?.fit ?? "", care: d.product.details?.care ?? "", delivery: d.product.details?.delivery ?? "" },
  featured: d.product.featured,
  badge: d.product.badgeOverride ?? "",
});

/** Only the fields that changed, ready for `PATCH /admin/products/{id}`; null when nothing did. Status is saved separately. */
export function changedFields(was: Basics, now: Basics, wasCategories: string[]): ProductFields | null {
  const out: ProductFields = {};
  if (now.title.trim() !== was.title) out.title = now.title.trim();
  if (now.description !== was.description) out.description = now.description.trim() || null;
  if (now.seoTitle !== was.seoTitle) out.seoTitle = now.seoTitle.trim() || null;
  if (now.seoDescription !== was.seoDescription) out.seoDescription = now.seoDescription.trim() || null;
  if (JSON.stringify(now.details) !== JSON.stringify(was.details)) out.details = now.details;
  if (now.featured !== was.featured) out.featured = now.featured;
  if (now.badge !== was.badge) out.badgeOverride = now.badge.trim() || null;
  if (now.categoryId !== was.categoryId) {
    // The design offers one category; other categories the product has are kept.
    const others = wasCategories.filter((c) => c !== was.categoryId);
    out.categoryIds = now.categoryId ? [now.categoryId, ...others] : others;
  }
  return Object.keys(out).length ? out : null;
}

/** What can be done to a product's status from where it is (the API publishes and archives; it has no "unpublish to draft"). */
export const STATUS_CHOICES: Record<AdminProductStatus, { value: AdminProductStatus; label: string }[]> = {
  draft: [{ value: "draft", label: "Draft" }, { value: "active", label: "Active (publish)" }],
  active: [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }],
  archived: [{ value: "archived", label: "Archived" }, { value: "active", label: "Active (publish)" }],
};

export const validateBasics = (b: Basics): { title?: string } => (b.title.trim() ? {} : { title: "Enter a name for the product" });
