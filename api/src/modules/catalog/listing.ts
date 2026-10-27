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

export type Badge = { kind: 'sale' | 'new' | 'low_stock' | 'featured' | 'custom'; label: string };
export type ColourOption = { label: string; valueKey: string; swatch: string | null };

export type ProductCard = {
  id: string;
  slug: string;
  title: string;
  /** Staff-set badge text, if any. `badges` is the full computed list including this one. */
  badge: string | null;
  badges: Badge[];
  /** Colour option values that can actually be bought, for the dots on a card. */
  colours: ColourOption[];
  /** Smallest and largest numeric length (inches) among buyable variants; null when the product has no length option. */
  lengthRange: { min: number; max: number } | null;
  featured: boolean;
  /** `compareAtMinor` is the struck-through "was" price of the cheapest variant, when that variant is on sale. */
  price: { minAmountMinor: number; maxAmountMinor: number; compareAtMinor: number | null; currency: string };
  inStock: boolean;
  onOffer: boolean;
  rating: { average: number; count: number };
  image: { objectKey: string; altText: string | null; width: number | null; height: number | null } | null;
};

export type ProductPage = { data: ProductCard[]; page: { nextCursor: string | null; /** Matching products across all pages; only sent with the first page. */ total: number | null } };

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
  input: { filters: ProductFilters; sort: ProductSort; limit: number; cursor?: string; /** Skip the `total` count when the caller only wants cards (the home page). Default: count the first page. */ withTotal?: boolean },
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

  const cards = await decorateCards(db, pageRows.map(toCard));
  const total = input.cursor || input.withTotal === false ? null : await countProducts(db, input.filters);

  return {
    data: cards,
    page: {
      total,
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
    badges: [],
    colours: [],
    lengthRange: null,
    featured: r.featured as boolean,
    price: {
      minAmountMinor: Number(r.min_price),
      maxAmountMinor: Number(r.max_price),
      compareAtMinor: null,
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

const NEW_WINDOW_DAYS = 14;
const LOW_STOCK_DEFAULT = 3;

/** Number of visible products matching the filters (what "Show N wigs" reports). */
export async function countProducts(db: Db, filters: ProductFilters): Promise<number> {
  const where = [visibleProduct, ...buildFilters(filters)];
  const [row] = (await db.execute(sql`select count(*)::int as n from products p where ${sql.join(where, sql` and `)}`)) as unknown as { n: number }[];
  return row?.n ?? 0;
}

/**
 * Adds colour dots, length range and badges to a page of cards. Done as one extra query over only the page's
 * products, rather than per-row joins in the listing query, which would run for every matching product.
 */
export async function decorateCards(db: Db, cards: ProductCard[]): Promise<ProductCard[]> {
  if (cards.length === 0) return cards;
  const rows = (await db.execute(sql`
    select p.id, p.featured, coalesce(p.published_at, p.created_at) as pub,
      (select coalesce(json_agg(json_build_object('label', pov.label, 'valueKey', pov.value_key, 'swatch', pov.swatch) order by pov.sort_order), '[]'::json)
         from product_options po join product_option_values pov on pov.option_id = po.id and pov.active
         where po.product_id = p.id and lower(po.name) = 'colour'
           and exists (select 1 from variant_option_values vov join product_variants v on v.id = vov.variant_id and v.active where vov.option_value_id = pov.id)) as colours,
      (select min(pov.value_key::numeric) from product_options po join product_option_values pov on pov.option_id = po.id and pov.active
         where po.product_id = p.id and lower(po.name) = 'length' and pov.value_key ~ '^[0-9]+([.][0-9]+)?$'
           and exists (select 1 from variant_option_values vov join product_variants v on v.id = vov.variant_id and v.active where vov.option_value_id = pov.id)) as len_min,
      (select max(pov.value_key::numeric) from product_options po join product_option_values pov on pov.option_id = po.id and pov.active
         where po.product_id = p.id and lower(po.name) = 'length' and pov.value_key ~ '^[0-9]+([.][0-9]+)?$'
           and exists (select 1 from variant_option_values vov join product_variants v on v.id = vov.variant_id and v.active where vov.option_value_id = pov.id)) as len_max,
      (select case when v.compare_at_price_minor > v.price_minor then v.compare_at_price_minor end
         from product_variants v where v.product_id = p.id and v.active order by v.price_minor asc, v.compare_at_price_minor desc nulls last limit 1) as compare_at,
      (select max(round((v.compare_at_price_minor - v.price_minor) * 100.0 / v.compare_at_price_minor))::int
         from product_variants v where v.product_id = p.id and v.active and v.compare_at_price_minor > v.price_minor) as sale_pct,
      (select coalesce(bool_or(coalesce(i.on_hand_quantity - i.reserved_quantity, 0) between 1 and coalesce(i.low_stock_threshold, ${LOW_STOCK_DEFAULT})), false)
         from product_variants v left join inventory i on i.variant_id = v.id where v.product_id = p.id and v.active) as low_stock
    from products p where p.id in (${list(cards.map((c) => c.id))})`)) as unknown as Record<string, unknown>[];
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const cutoff = Date.now() - NEW_WINDOW_DAYS * 86_400_000;

  return cards.map((card) => {
    const r = byId.get(card.id);
    if (!r) return card;
    const badges: Badge[] = [];
    if (card.badge) badges.push({ kind: 'custom', label: card.badge });
    if (r.sale_pct) badges.push({ kind: 'sale', label: `-${r.sale_pct}%` });
    if (r.low_stock && card.inStock) badges.push({ kind: 'low_stock', label: 'Low stock' });
    if (new Date(r.pub as string).getTime() >= cutoff) badges.push({ kind: 'new', label: 'New' });
    if (r.featured) badges.push({ kind: 'featured', label: 'Featured' });
    return {
      ...card,
      badges,
      price: { ...card.price, compareAtMinor: r.compare_at === null || r.compare_at === undefined ? null : Number(r.compare_at) },
      colours: r.colours as ColourOption[],
      lengthRange: r.len_min === null ? null : { min: Number(r.len_min), max: Number(r.len_max) },
    };
  });
}

export const FACET_OPTIONS = ['texture', 'lace', 'length', 'density', 'colour'] as const;

export type Facets = {
  options: Record<(typeof FACET_OPTIONS)[number], { valueKey: string; label: string; swatch: string | null; count: number }[]>;
  price: { minMinor: number; maxMinor: number } | null;
  inStockCount: number;
  onOfferCount: number;
};

/**
 * What the filter sheet can offer given the current selection. Each option's counts ignore that option's own
 * selection (so picking "HD" still shows how many "Transparent" would match), and the price range ignores the
 * price filter. Counts are of products having *some* buyable variant with the value, so they can slightly
 * overstate when a product's values never occur together; the listing `total` is exact.
 */
export async function getFacets(db: Db, filters: ProductFilters): Promise<Facets> {
  const withoutOption = (name: string): ProductFilters => ({ ...filters, options: Object.fromEntries(Object.entries(filters.options).filter(([k]) => k !== name)) });

  const optionRows = await Promise.all(
    FACET_OPTIONS.map(async (name) => {
      const where = [visibleProduct, ...buildFilters(withoutOption(name))];
      const rows = (await db.execute(sql`
        select pov.value_key, min(pov.label) as label, min(pov.swatch) as swatch, min(pov.sort_order) as sort_order, count(distinct p.id)::int as n
        from products p
        join product_options po on po.product_id = p.id and lower(po.name) = ${name}
        join product_option_values pov on pov.option_id = po.id and pov.active
        where ${sql.join(where, sql` and `)}
          and exists (select 1 from variant_option_values vov join product_variants v on v.id = vov.variant_id and v.active where vov.option_value_id = pov.id)
        group by pov.value_key
        -- Numeric keys (lengths) sort as numbers, everything else in the owner's order.
        order by case when pov.value_key ~ '^[0-9]+([.][0-9]+)?$' then pov.value_key::numeric end nulls last, min(pov.sort_order), min(pov.label)`)) as unknown as Record<string, unknown>[];
      return [name, rows.map((r) => ({ valueKey: r.value_key as string, label: r.label as string, swatch: (r.swatch as string | null) ?? null, count: r.n as number }))] as const;
    }),
  );

  const noPrice: ProductFilters = { ...filters };
  delete noPrice.minPrice;
  delete noPrice.maxPrice;
  const [priceRow] = (await db.execute(sql`
    select min(v.price_minor)::bigint as lo, max(v.price_minor)::bigint as hi
    from products p join product_variants v on v.product_id = p.id and v.active
    where ${sql.join([visibleProduct, ...buildFilters(noPrice)], sql` and `)}`)) as unknown as { lo: string | null; hi: string | null }[];

  const [inStockCount, onOfferCount] = await Promise.all([countProducts(db, { ...filters, inStock: true }), countProducts(db, { ...filters, onOffer: true })]);

  return {
    options: Object.fromEntries(optionRows) as Facets['options'],
    price: priceRow?.lo == null || priceRow.hi == null ? null : { minMinor: Number(priceRow.lo), maxMinor: Number(priceRow.hi) },
    inStockCount,
    onOfferCount,
  };
}
