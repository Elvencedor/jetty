import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { contentEntries, products, promotions } from '../../db/schema/index.js';
import { decodeCursor, encodeCursor } from '../../lib/cursor.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { BODY_SCHEMAS, type ContentType } from '../content/content.js';
import { slugify } from './products.js';
import { uniqueViolation } from '../../lib/sql.js';
import { likeContains } from '../../lib/sql.js';

export type ContentInput = {
  contentType: ContentType;
  title: string;
  slug?: string | undefined;
  body: Record<string, unknown>;
  status?: 'draft' | 'published' | 'archived' | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
  sortOrder?: number | undefined;
};

function checkBody(type: ContentType, body: unknown): Record<string, unknown> {
  const { value, error } = BODY_SCHEMAS[type].validate(body, { abortEarly: false });
  if (error) throw unprocessable('VALIDATION_FAILED', `The ${type.replace('_', ' ')} content is not valid.`, error.details.map((d) => ({ path: `body.${d.path.join('.')}`, code: d.type, message: d.message })));
  return value as Record<string, unknown>;
}

/** References inside a body must point at something that exists, so a typo is caught when saving, not on the storefront. */
async function checkReferences(db: Db, type: ContentType, body: Record<string, unknown>) {
  if (type === 'featured_products') {
    const ids = body.productIds as string[];
    if (ids.length === 0) return;
    const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, ids));
    if (found.length !== ids.length) throw unprocessable('VALIDATION_FAILED', 'One or more featured products do not exist.', [{ path: 'body.productIds', code: 'any.invalid' }]);
  }
  if (type === 'flash') {
    const [promo] = await db.select({ id: promotions.id }).from(promotions).where(eq(promotions.id, body.promotionId as string));
    if (!promo) throw unprocessable('VALIDATION_FAILED', 'That promotion does not exist.', [{ path: 'body.promotionId', code: 'any.invalid' }]);
  }
}

function checkWindow(startsAt: Date | null | undefined, endsAt: Date | null | undefined) {
  if (startsAt && endsAt && startsAt >= endsAt) throw unprocessable('VALIDATION_FAILED', 'The end must be after the start.', [{ path: 'endsAt', code: 'any.invalid' }]);
}

export async function createContent(db: Db, adminId: string, input: ContentInput) {
  const body = checkBody(input.contentType, input.body);
  await checkReferences(db, input.contentType, body);
  checkWindow(input.startsAt, input.endsAt);
  // Pages are addressed by slug, so an explicit clash is the caller's to fix; other types only need a unique internal slug.
  // The home layout is a singleton: one fixed slug, so a second one is a conflict rather than a silent duplicate.
  const singleton = input.contentType === 'home_layout';
  const explicit = singleton || Boolean(input.slug);
  const base = singleton ? 'home' : (input.slug ?? slugify(input.title));
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      // Its own (savepoint) transaction: a unique violation must not poison a caller's surrounding transaction.
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(contentEntries)
          .values({ contentType: input.contentType, slug, title: input.title, body, status: input.status ?? 'draft', startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, sortOrder: input.sortOrder ?? 0, createdByAdminId: adminId })
          .returning();
        return row!;
      });
    } catch (err) {
      if (!uniqueViolation(err)) throw err;
      if (explicit) throw conflict('SLUG_TAKEN', 'Another entry of this type already uses this slug.');
    }
  }
  throw conflict('SLUG_TAKEN', 'Could not find a free slug; set one explicitly.');
}

export async function updateContent(db: Db, id: string, patch: Partial<Omit<ContentInput, 'contentType'>>) {
  const [before] = await db.select().from(contentEntries).where(eq(contentEntries.id, id));
  if (!before) throw notFound('Content entry not found.');
  const type = before.contentType as ContentType;
  const body = patch.body ? checkBody(type, patch.body) : undefined;
  if (body) await checkReferences(db, type, body);
  const startsAt = patch.startsAt === undefined ? before.startsAt : patch.startsAt;
  const endsAt = patch.endsAt === undefined ? before.endsAt : patch.endsAt;
  checkWindow(startsAt, endsAt);
  try {
    const [after] = await db
      .update(contentEntries)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(body ? { body } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        startsAt,
        endsAt,
        updatedAt: new Date(),
      })
      .where(eq(contentEntries.id, id))
      .returning();
    return { before, after: after! };
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('SLUG_TAKEN', 'Another entry of this type already uses this slug.');
    throw err;
  }
}

export async function listContent(db: Db, input: { type?: ContentType | undefined; status?: string | undefined; q?: string | undefined; limit: number; cursor?: string | undefined }) {
  const where = [sql`true`];
  if (input.type) where.push(sql`c.content_type = ${input.type}`);
  if (input.status) where.push(sql`c.status = ${input.status}`);
  if (input.q) where.push(sql`(c.title ilike ${likeContains(input.q)})`);
  let after = sql``;
  if (input.cursor) {
    const [at, id] = decodeCursor(input.cursor, 'admin-content', 2);
    after = sql`and (c.updated_at, c.id) < (${at}::timestamptz, ${id}::uuid)`;
  }
  const rows = (await db.execute(sql`
    select c.*, c.updated_at::text as cur_at from content_entries c
    where ${sql.join(where, sql` and `)} ${after} order by c.updated_at desc, c.id desc limit ${input.limit + 1}`)) as unknown as Record<string, unknown>[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    data: page.map((r) => ({
      id: r.id as string, contentType: r.content_type as string, slug: r.slug as string, title: r.title as string, body: r.body, status: r.status as string,
      startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), sortOrder: r.sort_order as number, updatedAt: iso(r.updated_at),
    })),
    page: { nextCursor: hasMore && last ? encodeCursor({ sort: 'admin-content', values: [String(last.cur_at), String(last.id)] }) : null },
  };
}

export async function getContent(db: Db, id: string) {
  const [row] = await db.select().from(contentEntries).where(eq(contentEntries.id, id));
  if (!row) throw notFound('Content entry not found.');
  return row;
}
