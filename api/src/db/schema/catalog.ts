import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, money, tstz, updatedAt } from './_helpers.js';
import { customers } from './identity.js';

export const productStatus = pgEnum('product_status', ['draft', 'active', 'archived']);

export const products = pgTable(
  'products',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    status: productStatus('status').notNull().default('draft'),
    featured: boolean('featured').notNull().default(false),
    badgeOverride: text('badge_override'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    detailsJson: jsonb('details_json').notNull().default(sql`'{}'::jsonb`),
    // Free-form labels the owner files products under ("bestseller", "summer"); for the admin's own organising and search.
    tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
    publishedAt: tstz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('products_active_published_idx').on(t.publishedAt).where(sql`${t.status} = 'active'`),
    // Initial P0 search: PostgreSQL full-text over title and description.
    index('products_search_idx').using(
      'gin',
      sql`to_tsvector('english', coalesce(${t.title}, '') || ' ' || coalesce(${t.description}, ''))`,
    ),
  ],
);

export const productOptions = pgTable(
  'product_options',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('product_options_product_name_uq').on(t.productId, t.name)],
);

export const productOptionValues = pgTable(
  'product_option_values',
  {
    id: id(),
    optionId: uuid('option_id')
      .notNull()
      .references(() => productOptions.id),
    label: text('label').notNull(),
    valueKey: text('value_key').notNull(),
    priceDeltaMinor: money('price_delta_minor').notNull().default(0),
    // Display colour (#rrggbb) for colour options; null for everything else.
    swatch: text('swatch'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [check('product_option_values_swatch_hex', sql`${t.swatch} is null or ${t.swatch} ~ '^#[0-9a-fA-F]{6}$'`), uniqueIndex('product_option_values_option_key_uq').on(t.optionId, t.valueKey)],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    sku: text('sku').notNull(),
    optionSignature: jsonb('option_signature').notNull(),
    priceMinor: money('price_minor').notNull(),
    compareAtPriceMinor: money('compare_at_price_minor'),
    currency: text('currency').notNull().default('NGN'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('product_variants_price_nonneg', sql`${t.priceMinor} >= 0`),
    check(
      'product_variants_compare_at_valid',
      sql`${t.compareAtPriceMinor} is null or ${t.compareAtPriceMinor} >= ${t.priceMinor}`,
    ),
    uniqueIndex('product_variants_sku_uq').on(sql`upper(${t.sku})`),
    uniqueIndex('product_variants_signature_uq').on(t.productId, t.optionSignature),
    index('product_variants_product_active_idx').on(t.productId, t.active),
  ],
);

export const variantOptionValues = pgTable(
  'variant_option_values',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    optionValueId: uuid('option_value_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.optionValueId] }),
    foreignKey({
      name: 'variant_option_values_option_value_fk',
      columns: [t.optionValueId],
      foreignColumns: [productOptionValues.id],
    }),
  ],
);

export const productMedia = pgTable(
  'product_media',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    variantId: uuid('variant_id').references(() => productVariants.id),
    objectKey: text('object_key').notNull(),
    altText: text('alt_text'),
    mediaType: text('media_type').notNull().default('image'),
    angle: text('angle'),
    sortOrder: integer('sort_order').notNull().default(0),
    isCover: boolean('is_cover').notNull().default(false),
    width: integer('width'),
    height: integer('height'),
    createdAt: createdAt(),
  },
  (t) => [
    index('product_media_product_idx').on(t.productId, t.sortOrder),
    uniqueIndex('product_media_one_cover_uq').on(t.productId).where(sql`${t.isCover}`),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: id(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const productCategories = pgTable(
  'product_categories',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    index('product_categories_category_idx').on(t.categoryId, t.productId),
  ],
);

export const collections = pgTable('collections', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  rulesJson: jsonb('rules_json'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const productCollections = pgTable(
  'product_collections',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.collectionId] }),
    index('product_collections_collection_idx').on(t.collectionId, t.sortOrder),
  ],
);

// available_quantity is derived (on_hand - reserved); it is intentionally not stored.
export const inventory = pgTable(
  'inventory',
  {
    variantId: uuid('variant_id')
      .primaryKey()
      .references(() => productVariants.id),
    onHandQuantity: integer('on_hand_quantity').notNull().default(0),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'inventory_quantities_valid',
      sql`${t.onHandQuantity} >= ${t.reservedQuantity} and ${t.reservedQuantity} >= 0`,
    ),
  ],
);

export const backInStockStatus = pgEnum('back_in_stock_status', ['active', 'notified', 'cancelled']);

export const backInStockSubscriptions = pgTable(
  'back_in_stock_subscriptions',
  {
    id: id(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    customerId: uuid('customer_id').references(() => customers.id),
    email: text('email'),
    phoneE164: text('phone_e164'),
    status: backInStockStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    notifiedAt: tstz('notified_at'),
  },
  (t) => [
    check('back_in_stock_contact_present', sql`${t.email} is not null or ${t.phoneE164} is not null`),
    uniqueIndex('back_in_stock_active_email_uq')
      .on(t.variantId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'active' and ${t.email} is not null`),
    uniqueIndex('back_in_stock_active_phone_uq')
      .on(t.variantId, t.phoneE164)
      .where(sql`${t.status} = 'active' and ${t.phoneE164} is not null`),
  ],
);

export const wishlists = pgTable(
  'wishlists',
  {
    id: id(),
    customerId: uuid('customer_id').references(() => customers.id),
    guestTokenHash: text('guest_token_hash').unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('wishlists_owner_present', sql`${t.customerId} is not null or ${t.guestTokenHash} is not null`),
    uniqueIndex('wishlists_customer_uq').on(t.customerId).where(sql`${t.customerId} is not null`),
  ],
);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    wishlistId: uuid('wishlist_id')
      .notNull()
      .references(() => wishlists.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.wishlistId, t.variantId] })],
);

export const savedPaymentMethods = pgTable(
  'saved_payment_methods',
  {
    id: id(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    provider: text('provider').notNull(),
    providerCustomerToken: text('provider_customer_token'),
    providerMethodToken: text('provider_method_token').notNull().unique(),
    brand: text('brand'),
    lastFour: text('last_four'),
    expiryMonth: integer('expiry_month'),
    expiryYear: integer('expiry_year'),
    createdAt: createdAt(),
  },
  (t) => [index('saved_payment_methods_customer_idx').on(t.customerId)],
);
