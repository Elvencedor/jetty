import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { escapeLike } from '../../lib/sql.js';

export const PRODUCT_SORTS = ['recommended', 'bestSelling', 'newest', 'priceAsc', 'priceDesc', 'topRated'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

// Every sort is a tuple of non-null columns ending in the unique id, all in one
// direction, so a row-value comparison gives a correct, stable keyset cursor.
const SORT_DEFS: Record<ProductSort, { dir: 'asc' | 'desc'; cols: { name: string; type: string }[] }> = {
  recommended: {
    dir: 'desc',
    cols: [
      { name: 'featured_rank', type: 'int' },
      { name: 'pub', type: 'timestamptz' },
      { name: 'id', type: 'uuid' },
    ],
  },
  newest: {
    dir: 'desc',
    cols: [
      { name: 'pub', type: 'timestamptz' },
      { name: 'id', type: 'uuid' },
    ],
  },
  bestSelling: {
    dir: 'desc',
    cols: [
      { name: 'sold', type: 'bigint' },
      { name: 'pub', type: 'timestamptz' },
      { name: 'id', type: 'uuid' },
    ],
  },
  topRated: {
    dir: 'desc',
    cols: [
      { name: 'rating_avg', type: 'numeric' },
      { name: 'rating_count', type: 'bigint' },
      { name: 'id', type: 'uuid' },
    ],
  },
  priceAsc: {
    dir: 'asc',
    cols: [
      { name: 'min_price', type: 'bigint' },
      { name: 'id', type: 'uuid' },
    ],
  },
  priceDesc: {
    dir: 'desc',
    cols: [
      { name: 'min_price', type: 'bigint' },
      { name: 'id', type: 'uuid' },
    ],
  },
};

export type ProductFilters = {
  q?: string;
  /** Option name (e.g. texture, lace, length, density, colour) to accepted value keys. */
  options: Record<string, string[]>;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onOffer?: boolean;
  categorySlug?: string;
  collectionSlug?: string;
  /** Restrict to these product ids (e.g. a curated row); the caller restores order. */
  ids?: string[];
};

export type ProductCard = {
  id: string;
  slug: string;
  title: string;
  badge: string | null;
  featured: boolean;
  price: { minAmountMinor: number; maxAmountMinor: number; currency: string };
  inStock: boolean;
  onOffer: boolean;
  rating: { average: number; count: number };
  image: { objectKey: string; altText: string | null; width: number | null; height: number | null } | null;
};

export type ProductPage = { data: ProductCard[]; page: { nextCursor: string | null } };

const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/** Public visibility rule shared by every storefront product query. */
export const visibleProduct = sql`p.status = 'active' and (p.published_at is null or p.published_at <= now())`;

function buildFilters(f: ProductFilters): SQL[] {
  const where: SQL[] = [];

  if (f.q) {
    where.push(
      sql`(to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.description, '')) @@ websearch_to_tsquery('english', ${f.q})
        or p.title ilike ${`%${escapeLike(f.q)}%`})`,
    );
  }
  if (f.ids) where.push(f.ids.length > 0 ? sql`p.id in (${list(f.ids)})` : sql`false`);
  if (f.categorySlug) {
    where.push(sql`p.id in (
      select pc.product_id from product_categories pc where pc.category_id in (
        with recursive tree as (
          select id from categories where slug = ${f.categorySlug} and active
          union all
          select c.id from categories c join tree t on c.parent_id = t.id where c.active
        ) select id from tree))`);
  }
  if (f.collectionSlug) {
    where.push(sql`p.id in (
      select pcl.product_id from product_collections pcl join collections col on col.id = pcl.collection_id
      where col.slug = ${f.collectionSlug} and col.active)`);
  }

  // Variant-level filters must hold for one and the same variant, otherwise a
  // "26 inch" and an "in stock" match on different variants would be a false hit.
  const variant: SQL[] = [];
  if (f.minPrice !== undefined) variant.push(sql`fv.price_minor >= ${f.minPrice}`);
  if (f.maxPrice !== undefined) variant.push(sql`fv.price_minor <= ${f.maxPrice}`);
  if (f.inStock) variant.push(sql`coalesce(fi.on_hand_quantity - fi.reserved_quantity, 0) > 0`);
  if (f.onOffer) variant.push(sql`fv.compare_at_price_minor > fv.price_minor`);
  for (const [name, keys] of Object.entries(f.options)) {
    variant.push(sql`exists (
      select 1 from variant_option_values fvov
      join product_option_values fpov on fpov.id = fvov.option_value_id
      join product_options fpo on fpo.id = fpov.option_id
      where fvov.variant_id = fv.id and lower(fpo.name) = ${name} and fpov.value_key in (${list(keys)}))`);
  }
  if (variant.length > 0) {
    where.push(sql`exists (
      select 1 from product_variants fv left join inventory fi on fi.variant_id = fv.id
      where fv.product_id = p.id and fv.active and ${sql.join(variant, sql` and `)})`);
  }
  return where;
}

export async function listProducts(
  db: Db,
  input: { filters: ProductFilters; sort: ProductSort; limit: number; cursor?: string },
): Promise<ProductPage> {
  const def = SORT_DEFS[input.sort];
  const where = [visibleProduct, ...buildFilters(input.filters)];

  const cursorCondition = input.cursor
    ? (() => {
        const values = decodeCursor(input.cursor, input.sort, def.cols.length);
        const cols = sql.raw(def.cols.map((c) => `c.${c.name}`).join(', '));
        const params = sql.join(
          def.cols.map((c, i) => sql`${values[i]}::${sql.raw(c.type)}`),
          sql`, `,
        );
        return sql`where (${cols}) ${sql.raw(def.dir === 'desc' ? '<' : '>')} (${params})`;
      })()
    : sql``;

  const orderBy = sql.raw(def.cols.map((c) => `c.${c.name} ${def.dir}`).join(', '));
  const cursorSelect = sql.raw(def.cols.map((c, i) => `c.${c.name}::text as cur_${i}`).join(', '));

  const rows = (await db.execute(sql`
    select c.*, ${cursorSelect} from (
      select
        p.id, p.slug, p.title, p.badge_override, p.featured,
        p.featured::int as featured_rank,
        coalesce(p.published_at, p.created_at) as pub,
        v.min_price, v.max_price, v.currency, v.in_stock, v.on_offer,
        coalesce(r.rating_avg, 0) as rating_avg, coalesce(r.rating_count, 0) as rating_count,
        ${input.sort === 'bestSelling' ? sql`coalesce(s.sold, 0)` : sql`0::bigint`} as sold,
        m.object_key, m.alt_text, m.width, m.height
      from products p
      cross join lateral (
        select min(pv.price_minor) as min_price, max(pv.price_minor) as max_price, min(pv.currency) as currency,
          coalesce(bool_or(coalesce(i.on_hand_quantity - i.reserved_quantity, 0) > 0), false) as in_stock,
          coalesce(bool_or(pv.compare_at_price_minor > pv.price_minor), false) as on_offer
        from product_variants pv left join inventory i on i.variant_id = pv.id
        where pv.product_id = p.id and pv.active
        having count(*) > 0
      ) v
      left join lateral (
        select round(avg(rv.rating), 2) as rating_avg, count(*) as rating_count
        from reviews rv where rv.product_id = p.id and rv.status = 'approved'
      ) r on true
      ${input.sort === 'bestSelling' ? sql`      left join lateral (
        select sum(oi.quantity) as sold
        from order_items oi join orders o on o.id = oi.order_id
        where oi.product_id = p.id and o.payment_status = 'paid'
      ) s on true` : sql``}
      left join lateral (
        select pm.object_key, pm.alt_text, pm.width, pm.height
        from product_media pm where pm.product_id = p.id
        order by pm.is_cover desc, pm.sort_order asc, pm.created_at asc limit 1
      ) m on true
      where ${sql.join(where, sql` and `)}
    ) c
    ${cursorCondition}
    order by ${orderBy}
    limit ${input.limit + 1}
  `)) as unknown as Record<string, unknown>[];

  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    data: pageRows.map(toCard),
    page: {
      nextCursor:
        hasMore && last
          ? encodeCursor({ sort: input.sort, values: def.cols.map((_, i) => String(last[`cur_${i}`])) })
          : null,
    },
  };
}

function toCard(r: Record<string, unknown>): ProductCard {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    badge: (r.badge_override as string | null) ?? null,
    featured: r.featured as boolean,
    price: {
      minAmountMinor: Number(r.min_price),
      maxAmountMinor: Number(r.max_price),
      currency: r.currency as string,
    },
    inStock: r.in_stock as boolean,
    onOffer: r.on_offer as boolean,
    rating: { average: Number(r.rating_avg), count: Number(r.rating_count) },
    image: r.object_key
      ? {
          objectKey: r.object_key as string,
          altText: (r.alt_text as string | null) ?? null,
          width: (r.width as number | null) ?? null,
          height: (r.height as number | null) ?? null,
        }
      : null,
  };
}

export type Suggestion = { id: string; slug: string; title: string; image: ProductCard['image'] };

/** Type-ahead: titles with a word starting with the query, shortest titles first. Cheap by design (no ranking joins). */
export async function suggestProducts(db: Db, q: string, limit: number): Promise<Suggestion[]> {
  const term = escapeLike(q.toLowerCase());
  const rows = (await db.execute(sql`
    select p.id, p.slug, p.title, m.object_key, m.alt_text, m.width, m.height
    from products p
    left join lateral (
      select pm.object_key, pm.alt_text, pm.width, pm.height from product_media pm
      where pm.product_id = p.id order by pm.is_cover desc, pm.sort_order asc, pm.created_at asc limit 1
    ) m on true
    where ${visibleProduct}
      and (lower(p.title) like ${`${term}%`} or lower(p.title) like ${`% ${term}%`})
      and exists (select 1 from product_variants v where v.product_id = p.id and v.active)
    order by length(p.title), p.title
    limit ${limit}`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    image: r.object_key ? { objectKey: r.object_key as string, altText: (r.alt_text as string | null) ?? null, width: (r.width as number | null) ?? null, height: (r.height as number | null) ?? null } : null,
  }));
}
