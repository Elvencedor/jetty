import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { products } from './catalog.js';
import { createdAt, id, money, tstz, updatedAt } from './_helpers.js';
import { orderItems } from './commerce.js';
import { adminUsers, customers } from './identity.js';

export const reviewStatus = pgEnum('review_status', ['pending', 'approved', 'rejected', 'hidden']);

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    orderItemId: uuid('order_item_id').references(() => orderItems.id),
    rating: integer('rating').notNull(),
    title: text('title'),
    body: text('body'),
    location: text('location'),
    status: reviewStatus('status').notNull().default('pending'),
    verifiedBuyer: boolean('verified_buyer').notNull().default(false),
    createdAt: createdAt(),
    moderatedAt: tstz('moderated_at'),
  },
  (t) => [
    check('reviews_rating_range', sql`${t.rating} between 1 and 5`),
    uniqueIndex('reviews_order_item_customer_uq')
      .on(t.orderItemId, t.customerId)
      .where(sql`${t.orderItemId} is not null`),
    index('reviews_product_status_idx').on(t.productId, t.status, t.createdAt.desc()),
  ],
);

export const reviewMedia = pgTable(
  'review_media',
  {
    id: id(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id),
    objectKey: text('object_key').notNull(),
    altText: text('alt_text'),
    status: text('status').notNull().default('pending'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('review_media_review_idx').on(t.reviewId)],
);

export const deliveryZones = pgTable('delivery_zones', {
  id: id(),
  name: text('name').notNull(),
  state: text('state').notNull(),
  areas: jsonb('areas').notNull().default(sql`'[]'::jsonb`),
  active: boolean('active').notNull().default(true),
  sameDayCutoffLocal: text('same_day_cutoff_local'),
  timezone: text('timezone').notNull().default('Africa/Lagos'),
  sameDayFeeMinor: money('same_day_fee_minor'),
  nextDayFeeMinor: money('next_day_fee_minor'),
  nationwideFeeMinor: money('nationwide_fee_minor'),
  pickupEnabled: boolean('pickup_enabled').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const storeSettings = pgTable('store_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedByAdminId: uuid('updated_by_admin_id').references(() => adminUsers.id),
  updatedAt: updatedAt(),
});

export const contentEntries = pgTable(
  'content_entries',
  {
    id: id(),
    contentType: text('content_type').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    body: jsonb('body').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('draft'),
    startsAt: tstz('starts_at'),
    endsAt: tstz('ends_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('content_entries_window_valid', sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.startsAt} < ${t.endsAt}`),
    uniqueIndex('content_entries_type_slug_uq').on(t.contentType, t.slug),
  ],
);

export const contentPlacements = pgTable(
  'content_placements',
  {
    id: id(),
    contentEntryId: uuid('content_entry_id')
      .notNull()
      .references(() => contentEntries.id),
    placement: text('placement').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index('content_placements_placement_idx').on(t.placement, t.sortOrder)],
);

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: id(),
    eventType: text('event_type').notNull(),
    recipient: text('recipient').notNull(),
    channel: text('channel').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: tstz('next_attempt_at').notNull().defaultNow(),
    sentAt: tstz('sent_at'),
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    createdAt: createdAt(),
  },
  (t) => [index('notification_outbox_status_next_idx').on(t.status, t.nextAttemptAt)],
);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: id(),
    customerId: uuid('customer_id').references(() => customers.id),
    anonymousId: text('anonymous_id'),
    sessionId: text('session_id'),
    eventName: text('event_name').notNull(),
    properties: jsonb('properties').notNull().default(sql`'{}'::jsonb`),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
  },
  (t) => [index('analytics_events_name_time_idx').on(t.eventName, t.occurredAt)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idempotency_keys_scope_key_uq').on(t.scope, t.key),
    index('idempotency_keys_expires_idx').on(t.expiresAt),
  ],
);
