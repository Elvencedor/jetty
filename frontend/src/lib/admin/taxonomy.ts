import type { CategoryRow } from "@/lib/api/admin-catalog";

/** A URL-safe name: "Wig Types & Cuts" → "wig-types-cuts". */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);

export const isSlug = (v: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);

export type TreeRow = CategoryRow & { depth: number };

/** Categories as a flat list with children under their parent, each level in its saved order. An orphan shows at the top. */
export function categoryTree(rows: CategoryRow[]): TreeRow[] {
  const known = new Set(rows.map((r) => r.id));
  const kids = new Map<string | null, CategoryRow[]>();
  for (const r of rows) {
    const key = r.parentId && known.has(r.parentId) ? r.parentId : null;
    kids.set(key, [...(kids.get(key) ?? []), r]);
  }
  const out: TreeRow[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const r of (kids.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
      if (seen.has(r.id)) continue;
      out.push({ ...r, depth });
      walk(r.id, depth + 1, new Set([...seen, r.id]));
    }
  };
  walk(null, 0, new Set());
  return out;
}

/** The category and everything under it, which cannot become its own parent. */
export function selfAndDescendants(rows: CategoryRow[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (r.parentId && out.has(r.parentId) && !out.has(r.id)) {
        out.add(r.id);
        grew = true;
      }
    }
  }
  return out;
}

export type TaxonomyForm = { name: string; slug: string; sortOrder: string; active: boolean; parentId: string; description: string };
export type TaxonomyErrors = Partial<Record<"name" | "slug" | "sortOrder", string>>;

export function validateTaxonomy(f: TaxonomyForm): TaxonomyErrors {
  const e: TaxonomyErrors = {};
  if (!f.name.trim()) e.name = "Give it a name";
  else if (f.name.trim().length > 80) e.name = "Keep the name under 80 characters";
  if (f.slug.trim() && !isSlug(f.slug.trim())) e.slug = "Use lowercase letters, numbers and dashes, like wig-types";
  if (f.sortOrder.trim() && !/^\d{1,5}$/.test(f.sortOrder.trim())) e.sortOrder = "Enter a whole number, smallest first";
  return e;
}

export const productCountText = (n: number) => `${n} ${n === 1 ? "product" : "products"}`;
