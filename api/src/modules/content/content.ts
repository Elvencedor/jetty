import Joi from 'joi';
import { and, asc, eq, isNull, lte, gt, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { contentEntries } from '../../db/schema/index.js';
import { listProducts, type ProductCard } from '../catalog/listing.js';

export const CONTENT_TYPES = ['announcement', 'banner', 'page', 'featured_products'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;

// An absolute http(s) URL or a single-slash site path. `//host` and `/\host` are rejected: browsers treat them as another site.
const url = Joi.string().trim().max(500).pattern(/^(https?:\/\/\S+|\/(?![/\\])\S*)$/).messages({ 'string.pattern.base': 'must be an http(s) URL or a site path starting with a single /' });
const text = (max: number) => Joi.string().trim().min(1).max(max);

/** The `body` shape for each content type; JSON is data, never rendered as markup by the API. */
export const BODY_SCHEMAS: Record<ContentType, Joi.ObjectSchema> = {
  announcement: Joi.object({ text: text(200).required(), linkUrl: url, linkLabel: text(60) }),
  banner: Joi.object({
    headline: text(160).required(),
    subheadline: text(300),
    imageObjectKey: text(300),
    imageAlt: text(200),
    ctaLabel: text(60),
    ctaUrl: url,
  }),
  page: Joi.object({ markdown: Joi.string().max(100_000).required() }),
  featured_products: Joi.object({ heading: text(120), productIds: Joi.array().items(Joi.string().uuid()).unique().max(24).required() }),
};

const live = and(eq(contentEntries.status, 'published'), or(isNull(contentEntries.startsAt), lte(contentEntries.startsAt, sql`now()`)), or(isNull(contentEntries.endsAt), gt(contentEntries.endsAt, sql`now()`)));

export async function getHome(db: Db) {
  const entries = await db
    .select({ id: contentEntries.id, type: contentEntries.contentType, title: contentEntries.title, body: contentEntries.body, sortOrder: contentEntries.sortOrder })
    .from(contentEntries)
    .where(and(live, sql`${contentEntries.contentType} in ('announcement', 'banner', 'featured_products')`))
    .orderBy(asc(contentEntries.sortOrder), asc(contentEntries.createdAt));

  const of = (type: ContentType) => entries.filter((e) => e.type === type);
  const row = of('featured_products')[0];
  const curated = (row?.body as { productIds?: string[]; heading?: string } | undefined)?.productIds;

  let featured: ProductCard[];
  if (curated) {
    const { data } = await listProducts(db, { filters: { options: {}, ids: curated }, sort: 'recommended', limit: 100 });
    const byId = new Map(data.map((c) => [c.id, c]));
    // Curated order wins; products that are no longer visible simply drop out.
    featured = curated.flatMap((id) => byId.get(id) ?? []);
  } else {
    // No curated row: fall back to products flagged featured in the catalog.
    featured = (await listProducts(db, { filters: { options: {} }, sort: 'recommended', limit: 12 })).data.filter((c) => c.featured);
  }

  return {
    announcements: of('announcement').map((e) => ({ id: e.id, ...(e.body as object) })),
    banners: of('banner').map((e) => ({ id: e.id, ...(e.body as object) })),
    featured: { heading: (row?.body as { heading?: string } | undefined)?.heading ?? null, products: featured },
  };
}

export async function getPage(db: Db, slug: string) {
  const [page] = await db
    .select({ slug: contentEntries.slug, title: contentEntries.title, body: contentEntries.body, updatedAt: contentEntries.updatedAt })
    .from(contentEntries)
    .where(and(live, eq(contentEntries.contentType, 'page'), eq(contentEntries.slug, slug)));
  if (!page) return undefined;
  return { slug: page.slug, title: page.title, markdown: (page.body as { markdown: string }).markdown, updatedAt: page.updatedAt };
}
