import Joi from 'joi';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { contentEntries, deliveryZones, promotionCodes, promotions } from '../../db/schema/index.js';
import { listProducts, type ProductCard } from '../catalog/listing.js';
import { getSetting } from '../settings/settings.js';

export const CONTENT_TYPES = ['announcement', 'banner', 'page', 'featured_products', 'story', 'tile', 'flash', 'home_layout'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;

/** Every block the home page can contain. `quiz` and `ugc` are reserved: they render nothing until their data exists. */
export const SECTION_TYPES = ['stories', 'hero', 'flash', 'quiz', 'products', 'length', 'tiles', 'ugc', 'trust'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
export const TONES = ['pink', 'blush', 'plum', 'white'] as const;

// An absolute http(s) URL or a single-slash site path. `//host` and `/\host` are rejected: browsers treat them as another site.
const url = Joi.string().trim().max(500).pattern(/^(https?:\/\/\S+|\/(?![/\\])\S*)$/).messages({ 'string.pattern.base': 'must be an http(s) URL or a site path starting with a single /' });
const text = (max: number) => Joi.string().trim().min(1).max(max);
const tone = Joi.string().valid(...TONES);

/** The `body` shape for each content type; JSON is data, never rendered as markup by the API. */
export const BODY_SCHEMAS: Record<ContentType, Joi.ObjectSchema> = {
  announcement: Joi.object({ text: text(200).required(), linkUrl: url, linkLabel: text(60) }),
  banner: Joi.object({
    tag: text(40),
    headline: text(160).required(),
    subheadline: text(300),
    tone,
    imageObjectKey: text(300),
    imageAlt: text(200),
    ctaLabel: text(60),
    ctaUrl: url,
  }),
  page: Joi.object({ markdown: Joi.string().max(100_000).required() }),
  featured_products: Joi.object({ heading: text(120), productIds: Joi.array().items(Joi.string().uuid()).unique().max(24).required() }),
  story: Joi.object({ title: text(40).required(), imageObjectKey: text(300), imageAlt: text(200), linkUrl: url.required(), highlight: Joi.boolean() }),
  tile: Joi.object({ title: text(60).required(), subtitle: text(120), tone, imageObjectKey: text(300), imageAlt: text(200), linkUrl: url.required() }),
  flash: Joi.object({ promotionId: Joi.string().uuid().required(), headline: text(80) }),
  home_layout: Joi.object({
    sections: Joi.array()
      .items(Joi.object({ type: Joi.string().valid(...SECTION_TYPES).required(), enabled: Joi.boolean().default(true) }))
      .unique('type')
      .max(SECTION_TYPES.length)
      .required(),
  }),
};

const live = and(eq(contentEntries.status, 'published'), or(isNull(contentEntries.startsAt), lte(contentEntries.startsAt, sql`now()`)), or(isNull(contentEntries.endsAt), gt(contentEntries.endsAt, sql`now()`)));

type Entry = { id: string; title: string; body: Record<string, unknown>; endsAt: Date | null };

async function liveEntries(db: Db, types: ContentType[]): Promise<Record<string, Entry[]>> {
  const rows = await db
    .select({ id: contentEntries.id, type: contentEntries.contentType, title: contentEntries.title, body: contentEntries.body, endsAt: contentEntries.endsAt })
    .from(contentEntries)
    .where(and(live, inArray(contentEntries.contentType, types)))
    .orderBy(asc(contentEntries.sortOrder), asc(contentEntries.createdAt));
  const out: Record<string, Entry[]> = {};
  for (const r of rows) (out[r.type] ??= []).push({ id: r.id, title: r.title, body: r.body as Record<string, unknown>, endsAt: r.endsAt });
  return out;
}

const PICKS_PER_TAB = 8;

// Shown as bars on the home page; each links to the shop filtered to these lengths (inches).
const LENGTH_BANDS = [
  { label: '10–14"', hint: 'Shoulder', lengths: [10, 12, 14] },
  { label: '16–20"', hint: 'Chest', lengths: [16, 18, 20] },
  { label: '22–24"', hint: 'Waist', lengths: [22, 24] },
  { label: '26–28"', hint: 'Hip', lengths: [26, 28] },
  { label: '30"+', hint: 'Thigh', lengths: [30, 32, 34, 36] },
];

type Section = { type: SectionType } & Record<string, unknown>;

/**
 * The home page as an ordered list of blocks. Order and visibility come from the `home_layout` entry (default: every
 * block in canonical order). A block is omitted when it has nothing to show, so clients never render an empty title,
 * and nothing here depends on the shopper.
 */
export async function getHome(db: Db) {
  const entries = await liveEntries(db, ['announcement', 'banner', 'featured_products', 'story', 'tile', 'flash', 'home_layout']);
  const layout = (entries.home_layout?.[0]?.body as { sections?: { type: SectionType; enabled?: boolean }[] } | undefined)?.sections;
  // Blocks missing from a saved layout are appended hidden, so adding a block type later never surprises the owner.
  const order = layout ? [...layout.filter((s) => s.enabled !== false).map((s) => s.type)] : [...SECTION_TYPES];

  const builders: Partial<Record<SectionType, () => Promise<Section | null>>> = {
    stories: async () => {
      const items = (entries.story ?? []).map((e) => ({ id: e.id, ...e.body }));
      return items.length ? { type: 'stories', items } : null;
    },
    hero: async () => {
      const cards = (entries.banner ?? []).map((e) => ({ id: e.id, ...e.body, endsAt: e.endsAt?.toISOString() ?? null }));
      return cards.length ? { type: 'hero', cards } : null;
    },
    flash: async () => {
      for (const e of entries.flash ?? []) {
        const [promo] = await db
          .select({ id: promotions.id, name: promotions.name, endsAt: promotions.endsAt })
          .from(promotions)
          .where(and(eq(promotions.id, e.body.promotionId as string), eq(promotions.status, 'active'), or(isNull(promotions.startsAt), lte(promotions.startsAt, sql`now()`)), gt(promotions.endsAt, sql`now()`)));
        // A countdown needs an end; a promotion without one has nothing to count down to.
        if (!promo?.endsAt) continue;
        const [code] = await db.select({ code: promotionCodes.code }).from(promotionCodes).where(and(eq(promotionCodes.promotionId, promo.id), eq(promotionCodes.active, true))).orderBy(asc(promotionCodes.code)).limit(1);
        return { type: 'flash', promotionId: promo.id, headline: (e.body.headline as string | undefined) ?? promo.name, code: code?.code ?? null, endsAt: promo.endsAt.toISOString() };
      }
      return null;
    },
    products: async () => {
      const row = entries.featured_products?.[0];
      const curated = (row?.body as { productIds?: string[]; heading?: string } | undefined)?.productIds;
      let featured: ProductCard[];
      if (curated) {
        const { data } = await listProducts(db, { filters: { options: {}, ids: curated }, sort: 'recommended', limit: 100, withTotal: false });
        const byId = new Map(data.map((c) => [c.id, c]));
        // Curated order wins; products that are no longer visible simply drop out.
        featured = curated.flatMap((id) => byId.get(id) ?? []).slice(0, PICKS_PER_TAB);
      } else {
        // No curated row: fall back to products flagged featured in the catalog.
        featured = (await listProducts(db, { filters: { options: {} }, sort: 'recommended', limit: 24, withTotal: false })).data.filter((c) => c.featured).slice(0, PICKS_PER_TAB);
      }
      const [deal, care] = await Promise.all([
        listProducts(db, { filters: { options: {}, onOffer: true }, sort: 'recommended', limit: PICKS_PER_TAB, withTotal: false }),
        listProducts(db, { filters: { options: {}, categorySlug: 'hair-care' }, sort: 'recommended', limit: PICKS_PER_TAB, withTotal: false }),
      ]);
      const tabs = [
        { key: 'featured', label: 'Featured', products: featured },
        { key: 'deal', label: 'On deal', products: deal.data },
        { key: 'care', label: 'Care', products: care.data },
      ].filter((t) => t.products.length > 0);
      return tabs.length ? { type: 'products', title: (row?.body as { heading?: string } | undefined)?.heading ?? "Jetty's picks", tabs } : null;
    },
    length: async () => ({ type: 'length', title: 'Shop by length', items: LENGTH_BANDS }),
    tiles: async () => {
      const items = (entries.tile ?? []).slice(0, 3).map((e) => ({ id: e.id, ...e.body }));
      return items.length ? { type: 'tiles', items } : null;
    },
    trust: async () => {
      const [policies, sameDay] = await Promise.all([
        getSetting(db, 'policies'),
        db.select({ id: deliveryZones.id }).from(deliveryZones).where(and(eq(deliveryZones.active, true), sql`${deliveryZones.sameDayFeeMinor} is not null`)).limit(1),
      ]);
      const items = [
        { icon: 'shield-check', title: 'Secure pay', caption: 'Protected checkout' },
        ...(policies.returnWindowDays > 0 ? [{ icon: 'rotate-ccw', title: `${policies.returnWindowDays}-day returns`, caption: 'Unworn, lace uncut' }] : []),
        ...(sameDay.length ? [{ icon: 'truck', title: 'Same-day Lagos', caption: 'Order before the cut-off' }] : []),
        { icon: 'star', title: 'Real reviews', caption: 'Verified buyers only' },
      ];
      return { type: 'trust', items };
    },
  };

  const built = await Promise.all(order.map(async (type) => (await builders[type]?.()) ?? null));
  return {
    announcements: (entries.announcement ?? []).map((e) => ({ id: e.id, ...e.body })),
    sections: built.filter((s): s is Section => s !== null),
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
