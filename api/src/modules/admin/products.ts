import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import {
  categories,
  collections,
  inventory,
  inventoryMovements,
  productCategories,
  productCollections,
  productMedia,
  productOptionValues,
  productOptions,
  productVariants,
  products,
  variantOptionValues,
} from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import type { ObjectStorage } from '../media/storage.js';
import { withUrl, withUrls } from '../media/urls.js';
import { likeContains, uniqueViolation } from '../../lib/sql.js';

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'product';

// ---------------------------------------------------------------- listing

export type ProductListInput = { q?: string | undefined; status?: 'draft' | 'active' | 'archived' | undefined; stock?: 'out' | 'low' | undefined; limit: number; cursor?: string | undefined };

/** Keyset on (updated_at desc, id desc). Counts only active variants; stock is on-hand minus reserved. */
/** Products (not archived), their live variants, and how many of those products have a variant running low. */
async function catalogSummary(db: Db) {
  const [row] = (await db.execute(sql`
    select count(distinct p.id)::int as products, count(v.id)::int as variants,
      count(distinct p.id) filter (where i.low_stock_threshold is not null and i.on_hand_quantity - i.reserved_quantity <= i.low_stock_threshold)::int as low
    from products p left join product_variants v on v.product_id = p.id and v.active left join inventory i on i.variant_id = v.id
    where p.status <> 'archived'`)) as unknown as { products: number; variants: number; low: number }[];
  return { products: row!.products, variants: row!.variants, lowStock: row!.low };
}

export async function listAdminProducts(db: Db, input: ProductListInput, storage?: ObjectStorage) {
  const where = [sql`true`];
  if (input.status) where.push(sql`p.status = ${input.status}`);
  if (input.q) {
    const like = likeContains(input.q);
    where.push(sql`(p.title ilike ${like} or p.slug ilike ${like} or p.tags::text ilike ${like} or exists (select 1 from product_variants sv where sv.product_id = p.id and sv.sku ilike ${like}))`);
  }
  if (input.stock === 'out') where.push(sql`s.available <= 0`);
  if (input.stock === 'low') where.push(sql`s.low`);
  let after = sql``;
  if (input.cursor) {
    const [at, id] = decodeCursor(input.cursor, 'admin-products', 2);
    after = sql`and (p.updated_at, p.id) < (${at}::timestamptz, ${id}::uuid)`;
  }
  const rows = (await db.execute(sql`
    select p.id, p.slug, p.title, p.status, p.featured, p.tags, p.published_at, p.updated_at, p.updated_at::text as cur_at,
      s.variant_count, s.available, s.min_price, s.max_price, s.low,
      m.object_key as cover_key
    from products p
    cross join lateral (
      select count(*)::int as variant_count,
        coalesce(sum(greatest(coalesce(i.on_hand_quantity - i.reserved_quantity, 0), 0)), 0)::int as available,
        min(v.price_minor) as min_price,
        max(v.price_minor) as max_price,
        coalesce(bool_or(i.low_stock_threshold is not null and i.on_hand_quantity - i.reserved_quantity <= i.low_stock_threshold), false) as low
      from product_variants v left join inventory i on i.variant_id = v.id
      where v.product_id = p.id and v.active
    ) s
    left join lateral (select object_key from product_media where product_id = p.id order by is_cover desc, sort_order, created_at limit 1) m on true
    where ${sql.join(where, sql` and `)} ${after}
    order by p.updated_at desc, p.id desc
    limit ${input.limit + 1}`)) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  return {
    // Catalogue-wide figures for the page header, sent with the first page only.
    summary: input.cursor ? null : await catalogSummary(db),
    data: page.map((r) => ({
      id: r.id as string,
      slug: r.slug as string,
      title: r.title as string,
      status: r.status as string,
      featured: r.featured as boolean,
      tags: r.tags as string[],
      publishedAt: r.published_at ? new Date(r.published_at as string).toISOString() : null,
      updatedAt: new Date(r.updated_at as string).toISOString(),
      variantCount: r.variant_count as number,
      availableQuantity: r.available as number,
      lowStock: r.low as boolean,
      minPriceMinor: r.min_price === null ? null : Number(r.min_price),
      maxPriceMinor: r.max_price === null ? null : Number(r.max_price),
      coverObjectKey: (r.cover_key as string | null) ?? null,
      coverUrl: r.cover_key ? withUrl(storage, { objectKey: r.cover_key as string })!.url : null,
    })),
    page: { nextCursor: hasMore && last ? encodeCursor({ sort: 'admin-products', values: [String(last.cur_at), String(last.id)] }) : null },
  };
}

// ----------------------------------------------------------------- detail

export async function getAdminProduct(db: Db, id: string, storage?: ObjectStorage) {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) throw notFound('Product not found.');

  const [options, variants, media, cats, cols] = await Promise.all([
    db
      .select({ id: productOptions.id, name: productOptions.name, sortOrder: productOptions.sortOrder })
      .from(productOptions)
      .where(eq(productOptions.productId, id))
      .orderBy(asc(productOptions.sortOrder)),
    db
      .select({
        id: productVariants.id, sku: productVariants.sku, optionSignature: productVariants.optionSignature, priceMinor: productVariants.priceMinor,
        compareAtPriceMinor: productVariants.compareAtPriceMinor, currency: productVariants.currency, active: productVariants.active,
        onHand: inventory.onHandQuantity, reserved: inventory.reservedQuantity, lowStockThreshold: inventory.lowStockThreshold,
      })
      .from(productVariants)
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(eq(productVariants.productId, id))
      .orderBy(asc(productVariants.createdAt), asc(productVariants.sku)),
    db.select().from(productMedia).where(eq(productMedia.productId, id)).orderBy(asc(productMedia.sortOrder), asc(productMedia.createdAt)),
    db.select({ id: productCategories.categoryId }).from(productCategories).where(eq(productCategories.productId, id)),
    db.select({ id: productCollections.collectionId }).from(productCollections).where(eq(productCollections.productId, id)),
  ]);
  const values = options.length
    ? await db.select().from(productOptionValues).where(inArray(productOptionValues.optionId, options.map((o) => o.id))).orderBy(asc(productOptionValues.sortOrder))
    : [];

  return {
    product: { ...product, categoryIds: cats.map((c) => c.id), collectionIds: cols.map((c) => c.id) },
    options: options.map((o) => ({
      id: o.id,
      name: o.name,
      values: values.filter((v) => v.optionId === o.id).map((v) => ({ id: v.id, label: v.label, valueKey: v.valueKey, priceDeltaMinor: v.priceDeltaMinor, swatch: v.swatch, active: v.active })),
    })),
    variants: variants.map((v) => ({
      id: v.id, sku: v.sku, optionValues: '__retired' in (v.optionSignature as object) ? {} : v.optionSignature, priceMinor: v.priceMinor, compareAtPriceMinor: v.compareAtPriceMinor, currency: v.currency, active: v.active,
      stock: { onHand: v.onHand ?? 0, reserved: v.reserved ?? 0, available: Math.max((v.onHand ?? 0) - (v.reserved ?? 0), 0), lowStockThreshold: v.lowStockThreshold ?? null },
    })),
    media: withUrls(storage, media),
  };
}

// ----------------------------------------------------------------- create / edit

export type ProductFields = {
  title: string;
  slug?: string | undefined;
  description?: string | null | undefined;
  featured?: boolean | undefined;
  badgeOverride?: string | null | undefined;
  seoTitle?: string | null | undefined;
  seoDescription?: string | null | undefined;
  details?: { details?: string; fit?: string; care?: string; delivery?: string } | undefined;
  categoryIds?: string[] | undefined;
  collectionIds?: string[] | undefined;
  tags?: string[] | undefined;
};

/** Tags are matched by spelling, not case or spacing: "Best Seller " and "best seller" are one tag. */
export const normaliseTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean))];

async function assertExist(tx: Db | Tx, table: typeof categories | typeof collections, ids: string[], label: string) {
  if (ids.length === 0) return;
  const found = await tx.select({ id: table.id }).from(table).where(inArray(table.id, ids));
  if (found.length !== new Set(ids).size) throw unprocessable('VALIDATION_FAILED', `One or more ${label} do not exist.`, [{ path: `${label}Ids`, code: 'any.invalid' }]);
}

async function setMemberships(tx: Tx, productId: string, f: Pick<ProductFields, 'categoryIds' | 'collectionIds'>) {
  if (f.categoryIds) {
    await assertExist(tx, categories, f.categoryIds, 'category');
    await tx.delete(productCategories).where(eq(productCategories.productId, productId));
    if (f.categoryIds.length) await tx.insert(productCategories).values([...new Set(f.categoryIds)].map((categoryId) => ({ productId, categoryId })));
  }
  if (f.collectionIds) {
    await assertExist(tx, collections, f.collectionIds, 'collection');
    await tx.delete(productCollections).where(eq(productCollections.productId, productId));
    if (f.collectionIds.length) await tx.insert(productCollections).values([...new Set(f.collectionIds)].map((collectionId, sortOrder) => ({ productId, collectionId, sortOrder })));
  }
}

export async function createProduct(db: Db, input: ProductFields) {
  const explicit = Boolean(input.slug);
  const base = input.slug ?? slugify(input.title);
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      return await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(products)
          .values({
            slug,
            title: input.title,
            description: input.description ?? null,
            featured: input.featured ?? false,
            badgeOverride: input.badgeOverride ?? null,
            seoTitle: input.seoTitle ?? null,
            seoDescription: input.seoDescription ?? null,
            detailsJson: input.details ?? {},
            tags: normaliseTags(input.tags ?? []),
          })
          .returning();
        await setMemberships(tx, p!.id, input);
        return p!;
      });
    } catch (err) {
      if (uniqueViolation(err) && !explicit) continue;
      if (uniqueViolation(err)) throw conflict('SLUG_TAKEN', 'Another product already uses this slug.');
      throw err;
    }
  }
  throw conflict('SLUG_TAKEN', 'Could not find a free slug for this title; set one explicitly.');
}

export async function updateProduct(db: Db, id: string, patch: Partial<ProductFields>, check: (updatedAt: Date) => void) {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(products).where(eq(products.id, id)).for('update');
      if (!current) throw notFound('Product not found.');
      check(current.updatedAt);
      const [updated] = await tx
        .update(products)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.featured !== undefined ? { featured: patch.featured } : {}),
          ...(patch.badgeOverride !== undefined ? { badgeOverride: patch.badgeOverride } : {}),
          ...(patch.seoTitle !== undefined ? { seoTitle: patch.seoTitle } : {}),
          ...(patch.seoDescription !== undefined ? { seoDescription: patch.seoDescription } : {}),
          ...(patch.details !== undefined ? { detailsJson: patch.details } : {}),
          ...(patch.tags !== undefined ? { tags: normaliseTags(patch.tags) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(products.id, id))
        .returning();
      await setMemberships(tx, id, patch);
      return { before: current, after: updated! };
    });
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('SLUG_TAKEN', 'Another product already uses this slug.');
    throw err;
  }
}

/** Publishing needs something to sell: at least one active variant. `publishAt` may schedule a future go-live. */
export async function setProductStatus(db: Db, id: string, status: 'active' | 'archived', options: { publishAt?: Date | undefined } = {}) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(products).where(eq(products.id, id)).for('update');
    if (!current) throw notFound('Product not found.');
    if (status === 'active') {
      const [v] = await tx.select({ n: sql<number>`count(*)::int` }).from(productVariants).where(and(eq(productVariants.productId, id), eq(productVariants.active, true)));
      if (!v || v.n === 0) throw unprocessable('PRODUCT_NOT_PUBLISHABLE', 'Add at least one active variant before publishing.');
    }
    const publishedAt = status === 'active' ? (options.publishAt ?? current.publishedAt ?? new Date()) : current.publishedAt;
    const [after] = await tx.update(products).set({ status, publishedAt, updatedAt: new Date() }).where(eq(products.id, id)).returning();
    return { before: current, after: after! };
  });
}

// -------------------------------------------------------------- variant matrix

export type MatrixInput = {
  options: { name: string; values: { label: string; valueKey: string; priceDeltaMinor?: number | undefined; /** False hides the value from shoppers while keeping it for staff; default true. */ active?: boolean | undefined; swatch?: string | null | undefined }[] }[];
  variants: {
    id?: string | undefined;
    sku: string;
    optionValues?: Record<string, string> | undefined;
    priceMinor: number;
    compareAtPriceMinor?: number | null | undefined;
    active?: boolean | undefined;
    /** Opening stock for a variant created by this call; later changes go through the inventory ledger. */
    stock?: number | undefined;
  }[];
};

const BATCH = 500;

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

const bad = (path: string, message: string) => unprocessable('VALIDATION_FAILED', message, [{ path, code: 'any.invalid' }]);

/**
 * Replaces the product's option/variant matrix. Variants are matched by `id`
 * or by their option combination; ones left out are deactivated rather than
 * deleted, because orders, reservations and wishlists may still point at them.
 */
export async function replaceMatrix(db: Db, adminId: string | null, productId: string, input: MatrixInput, check: (updatedAt: Date) => void = () => undefined) {
  const names = input.options.map((o) => o.name);
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw bad('options', 'Option names must be unique.');
  for (const [i, o] of input.options.entries()) {
    if (new Set(o.values.map((v) => v.valueKey)).size !== o.values.length) throw bad(`options[${i}].values`, 'Option value keys must be unique within an option.');
  }
  const signatures = input.variants.map((v, i) => signatureOf(input.options, v, i));
  const keys = signatures.map((s) => JSON.stringify(Object.entries(s).sort()));
  if (new Set(keys).size !== keys.length) throw bad('variants', 'Two variants have the same option combination.');
  const skus = input.variants.map((v) => v.sku.toUpperCase());
  if (new Set(skus).size !== skus.length) throw bad('variants', 'SKUs must be unique.');
  if (input.variants.length === 0) throw bad('variants', 'A product needs at least one variant.');
  for (const [i, v] of input.variants.entries()) {
    if (v.compareAtPriceMinor != null && v.compareAtPriceMinor < v.priceMinor) throw bad(`variants[${i}].compareAtPriceMinor`, 'The compare-at price cannot be lower than the price.');
  }

  try {
    return await db.transaction(async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.id, productId)).for('update');
      if (!product) throw notFound('Product not found.');
      check(product.updatedAt);
      const priorVariants = await tx.select().from(productVariants).where(eq(productVariants.productId, productId));

      // Options and values: upsert, then retire what is no longer offered.
      const existingOptions = await tx.select().from(productOptions).where(eq(productOptions.productId, productId));
      const valueId = new Map<string, string>();
      const liveValueIds: string[] = [];
      for (const [oi, o] of input.options.entries()) {
        const found = existingOptions.find((e) => e.name.toLowerCase() === o.name.toLowerCase());
        const optionId = found
          ? (await tx.update(productOptions).set({ name: o.name, sortOrder: oi }).where(eq(productOptions.id, found.id)).returning({ id: productOptions.id }))[0]!.id
          : (await tx.insert(productOptions).values({ productId, name: o.name, sortOrder: oi }).returning({ id: productOptions.id }))[0]!.id;
        for (const [vi, v] of o.values.entries()) {
          const [row] = await tx
            .insert(productOptionValues)
            .values({ optionId, label: v.label, valueKey: v.valueKey, priceDeltaMinor: v.priceDeltaMinor ?? 0, swatch: v.swatch ?? null, sortOrder: vi, active: v.active ?? true })
            .onConflictDoUpdate({ target: [productOptionValues.optionId, productOptionValues.valueKey], set: { label: v.label, priceDeltaMinor: v.priceDeltaMinor ?? 0, swatch: v.swatch ?? null, sortOrder: vi, active: v.active ?? true } })
            .returning({ id: productOptionValues.id });
          valueId.set(`${o.name}\u0000${v.valueKey}`, row!.id);
          liveValueIds.push(row!.id);
        }
      }
      const allOptionIds = existingOptions.map((e) => e.id);
      if (allOptionIds.length) {
        await tx
          .update(productOptionValues)
          .set({ active: false })
          .where(and(inArray(productOptionValues.optionId, allOptionIds), liveValueIds.length ? sql`${productOptionValues.id} not in (${sql.join(liveValueIds.map((x) => sql`${x}`), sql`, `)})` : sql`true`));
      }

      const priorById = new Map(priorVariants.map((v) => [v.id, v]));
      const priorBySignature = new Map(priorVariants.map((v) => [JSON.stringify(Object.entries(v.optionSignature as object).sort()), v]));
      const priorBySku = new Map(priorVariants.map((v) => [v.sku.toUpperCase(), v]));
      const changes: { sku: string; before?: { priceMinor: number; active: boolean }; after: { priceMinor: number; active: boolean } }[] = [];

      // Match by id, else option combination, else SKU (which revives a variant retired earlier).
      const used = new Set<string>();
      const plan = input.variants.map((v, i) => {
        if (v.id && !priorById.has(v.id)) throw notFound(`Variant ${v.id} does not belong to this product.`);
        const prior = v.id ? priorById.get(v.id) : (priorBySignature.get(keys[i]!) ?? priorBySku.get(v.sku.toUpperCase()));
        if (prior) {
          if (used.has(prior.id)) throw bad(`variants[${i}]`, 'Two entries refer to the same existing variant.');
          used.add(prior.id);
        }
        return { v, signature: signatures[i]!, prior };
      });
      // Park every existing variant on a placeholder signature first, so reshuffling combinations cannot trip the unique index.
      if (priorVariants.length) await tx.execute(sql`update product_variants set option_signature = jsonb_build_object('__retired', id::text) where product_id = ${productId}`);

      // Set-based from here on: a product can have thousands of variants, and one query each would take minutes.
      const matched = plan.filter((p) => p.prior);
      const fresh = plan.filter((p) => !p.prior);
      const variantIdOf = new Map<(typeof plan)[number], string>();

      for (const batch of chunks(matched, BATCH)) {
        const rows = batch.map(
          (p) => sql`(${p.prior!.id}::uuid, ${p.v.sku}, ${JSON.stringify(p.signature)}::jsonb, ${p.v.priceMinor}::bigint, ${p.v.compareAtPriceMinor ?? null}::bigint, ${p.v.active ?? true}::boolean)`,
        );
        await tx.execute(sql`
          update product_variants pv set sku = d.sku, option_signature = d.sig, price_minor = d.price,
            compare_at_price_minor = d.compare, active = d.active, updated_at = now()
          from (values ${sql.join(rows, sql`, `)}) as d(id, sku, sig, price, compare, active)
          where pv.id = d.id`);
        for (const p of batch) {
          variantIdOf.set(p, p.prior!.id);
          const active = p.v.active ?? true;
          if (p.prior!.priceMinor !== p.v.priceMinor || p.prior!.active !== active) {
            changes.push({ sku: p.v.sku, before: { priceMinor: p.prior!.priceMinor, active: p.prior!.active }, after: { priceMinor: p.v.priceMinor, active } });
          }
        }
        await tx.delete(variantOptionValues).where(inArray(variantOptionValues.variantId, batch.map((p) => p.prior!.id)));
      }

      for (const batch of chunks(fresh, BATCH)) {
        const created = await tx
          .insert(productVariants)
          .values(batch.map((p) => ({ productId, sku: p.v.sku, optionSignature: p.signature, priceMinor: p.v.priceMinor, compareAtPriceMinor: p.v.compareAtPriceMinor ?? null, active: p.v.active ?? true })))
          .returning({ id: productVariants.id, sku: productVariants.sku });
        const idBySku = new Map(created.map((c) => [c.sku.toUpperCase(), c.id]));
        await tx.insert(inventory).values(batch.map((p) => ({ variantId: idBySku.get(p.v.sku.toUpperCase())!, onHandQuantity: p.v.stock ?? 0 })));
        const stocked = batch.filter((p) => p.v.stock);
        if (stocked.length) {
          await tx.insert(inventoryMovements).values(stocked.map((p) => ({ variantId: idBySku.get(p.v.sku.toUpperCase())!, quantityDelta: p.v.stock!, reason: 'initial_stock', adminUserId: adminId })));
        }
        for (const p of batch) {
          variantIdOf.set(p, idBySku.get(p.v.sku.toUpperCase())!);
          changes.push({ sku: p.v.sku, after: { priceMinor: p.v.priceMinor, active: p.v.active ?? true } });
        }
      }

      const links = plan.flatMap((p) => Object.entries(p.signature).map(([name, key]) => ({ variantId: variantIdOf.get(p)!, optionValueId: valueId.get(`${name}\u0000${key}`)! })));
      for (const batch of chunks(links, 2000)) await tx.insert(variantOptionValues).values(batch);
      const touched = new Set(variantIdOf.values());

      const dropped = priorVariants.filter((v) => !touched.has(v.id) && v.active);
      for (const batch of chunks(dropped, BATCH)) {
        await tx.update(productVariants).set({ active: false, updatedAt: new Date() }).where(inArray(productVariants.id, batch.map((v) => v.id)));
      }
      for (const v of dropped) changes.push({ sku: v.sku, before: { priceMinor: v.priceMinor, active: true }, after: { priceMinor: v.priceMinor, active: false } });
      // Dropped variants keep a unique signature slot; moving ones were rewritten above.
      if (product.status === 'active' && !input.variants.some((v) => v.active ?? true)) {
        throw unprocessable('PRODUCT_NOT_PUBLISHABLE', 'A live product needs at least one active variant. Archive it instead.');
      }
      await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
      return { changes };
    });
  } catch (err) {
    const constraint = uniqueViolation(err);
    if (constraint?.includes('sku')) throw conflict('SKU_TAKEN', 'One of these SKUs is already used by another variant.');
    if (constraint) throw conflict('VARIANT_CONFLICT', 'These variants conflict with existing ones.');
    throw err;
  }
}

function signatureOf(options: MatrixInput['options'], v: MatrixInput['variants'][number], index: number): Record<string, string> {
  const given = v.optionValues ?? {};
  const out: Record<string, string> = {};
  for (const o of options) {
    const key = given[o.name];
    if (!key || !o.values.some((x) => x.valueKey === key)) throw bad(`variants[${index}].optionValues.${o.name}`, `Pick one of the listed ${o.name} values.`);
    out[o.name] = key;
  }
  if (Object.keys(given).some((k) => !(k in out))) throw bad(`variants[${index}].optionValues`, 'Unknown option for this product.');
  return out;
}
