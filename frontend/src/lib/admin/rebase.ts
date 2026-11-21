import type { AdminProductDetail, ProductFields } from "@/lib/api/admin-catalog";
import { fromDetail, isChanged, type MatrixDraft } from "./matrix";
import { basicsFrom, changedFields, type Basics } from "./productForm";

const LABELS: Record<string, string> = {
  title: "the name",
  description: "the description",
  seoTitle: "the search title",
  seoDescription: "the search description",
  details: "the product details",
  featured: "featured",
  badgeOverride: "the badge",
  tags: "the tags",
  categoryIds: "the category",
  status: "the status",
  variants: "the options and variants",
};

/**
 * What both the admin and someone else changed since the admin opened the product. An edit made on top of a newer
 * version is safe to send again when this is empty: the two sets of changes touch different things. Anything listed
 * here would overwrite the other person's work, so the admin is asked instead.
 */
export function overlapWithRemote(args: {
  base: { basics: Basics; matrix: MatrixDraft; categoryIds: string[] };
  mine: { fields: ProductFields | null; matrixChanged: boolean; status: Basics["status"] };
  fresh: AdminProductDetail;
}): string[] {
  const { base, mine, fresh } = args;
  const theirs = changedFields(base.basics, basicsFrom(fresh), base.categoryIds);
  const clash = Object.keys(mine.fields ?? {}).filter((k) => theirs && k in theirs);
  if (mine.matrixChanged && isChanged(base.matrix, fromDetail(fresh))) clash.push("variants");
  const theirStatus = fresh.product.status;
  if (mine.status !== base.basics.status && theirStatus !== base.basics.status && theirStatus !== mine.status) clash.push("status");
  return clash.map((k) => LABELS[k] ?? k);
}
