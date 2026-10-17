import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import { productVariants, products } from './catalog.js';
import { adminUsers, customers } from './identity.js';

// ---------------------------------------------------------------- promotions

export const promotionStatus = pgEnum('promotion_status', ['draft', 'active', 'inactive', 'expired']);
export const promotionKind = pgEnum('promotion_kind', [
  'percentage',
  'fixed_amount',
  'buy_x_get_y',
  'free_delivery',
  'free_gift',
]);

export const promotions = pgTable(
  'promotions',
  {
    id: id(),
    name: text('name').notNull(),
    status: promotionStatus('status').notNull().default('draft'),
    kind: promotionKind('kind').notNull(),
    // Validated against versioned application schemas; never executed.
    configuration: jsonb('configuration').notNull(),
    scope: jsonb('scope').notNull().default(sql`'{}'::jsonb`),
    startsAt: tstz('starts_at'),
    endsAt: tstz('ends_at'),
    priority: integer('priority').notNull().default(0),
    stackable: boolean('stackable').notNull().default(false),
    totalUsageLimit: integer('total_usage_limit'),
    perCustomerLimit: integer('per_customer_limit'),
    usageCount: integer('usage_count').notNull().default(0),
    firstOrderOnly: boolean('first_order_only').notNull().default(false),
    minimumSubtotalMinor: money('minimum_subtotal_minor'),
    currency: text('currency').notNull().default('NGN'),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('promotions_window_valid', sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.startsAt} < ${t.endsAt}`),
    check('promotions_counts_valid', sql`${t.usageCount} >= 0`),
    check('promotions_minimum_nonneg', sql`${t.minimumSubtotalMinor} is null or ${t.minimumSubtotalMinor} >= 0`),
    index('promotions_status_window_idx').on(t.status, t.startsAt, t.endsAt),
  ],
);

export const promotionCodes = pgTable(
  'promotion_codes',
  {
    id: id(),
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id),
    code: text('code').notNull().unique(),
    maxRedemptions: integer('max_redemptions'),
    redemptionCount: integer('redemption_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    check('promotion_codes_code_normalized', sql`${t.code} = upper(btrim(${t.code}))`),
    check('promotion_codes_count_valid', sql`${t.redemptionCount} >= 0`),
    index('promotion_codes_promotion_idx').on(t.promotionId),
  ],
);

// ------------------------------------------------------------------- orders

export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'placed',
  'packed',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded',
  'payment_exception',
]);
export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'failed', 'refunded']);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    orderNumber: text('order_number').notNull().unique(),
    customerId: uuid('customer_id').references(() => customers.id),
    guestCheckoutTokenHash: text('guest_checkout_token_hash'),
    guestCheckoutTokenExpiresAt: tstz('guest_checkout_token_expires_at'),
    status: orderStatus('status').notNull().default('pending_payment'),
    paymentStatus: paymentStatus('payment_status').notNull().default('pending'),
    email: text('email').notNull(),
    phoneE164: text('phone_e164').notNull(),
    currency: text('currency').notNull().default('NGN'),
    subtotalMinor: money('subtotal_minor').notNull(),
    discountMinor: money('discount_minor').notNull().default(0),
    deliveryFeeMinor: money('delivery_fee_minor').notNull().default(0),
    taxMinor: money('tax_minor').notNull().default(0),
    totalMinor: money('total_minor').notNull(),
    deliveryAddressSnapshot: jsonb('delivery_address_snapshot').notNull(),
    deliveryMethod: text('delivery_method').notNull(),
    // Immutable snapshot of promotions applied at checkout; usage is claimed only once payment is confirmed.
    appliedPromotions: jsonb('applied_promotions').notNull().default(sql`'[]'::jsonb`),
    termsAcceptedAt: tstz('terms_accepted_at').notNull(),
    reservationExpiresAt: tstz('reservation_expires_at'),
    placedAt: tstz('placed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'orders_amounts_valid',
      sql`${t.subtotalMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.deliveryFeeMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.totalMinor} >= 0`,
    ),
    index('orders_created_idx').on(t.createdAt.desc()),
    index('orders_status_created_idx').on(t.status, t.createdAt.desc()),
    index('orders_customer_created_idx').on(t.customerId, t.createdAt.desc()),
    index('orders_pending_expiry_idx').on(t.reservationExpiresAt).where(sql`${t.status} = 'pending_payment'`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    skuSnapshot: text('sku_snapshot').notNull(),
    titleSnapshot: text('title_snapshot').notNull(),
    optionsSnapshot: jsonb('options_snapshot').notNull().default(sql`'{}'::jsonb`),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: money('unit_price_minor').notNull(),
    discountMinor: money('discount_minor').notNull().default(0),
    lineTotalMinor: money('line_total_minor').notNull(),
  },
  (t) => [
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'order_items_amounts_valid',
      sql`${t.unitPriceMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.lineTotalMinor} >= 0`,
    ),
    index('order_items_order_idx').on(t.orderId),
    index('order_items_variant_idx').on(t.variantId),
  ],
);

export const promotionRedemptions = pgTable(
  'promotion_redemptions',
  {
    id: id(),
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id),
    promotionCodeId: uuid('promotion_code_id').references(() => promotionCodes.id),
    customerId: uuid('customer_id').references(() => customers.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    discountMinor: money('discount_minor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('promotion_redemptions_discount_nonneg', sql`${t.discountMinor} >= 0`),
    uniqueIndex('promotion_redemptions_promotion_order_uq').on(t.promotionId, t.orderId),
    index('promotion_redemptions_customer_idx').on(t.promotionId, t.customerId),
  ],
);

/**
 * First-come-first-served slot on a limited promotion. Taken at checkout while
 * the order is unpaid, converted into a redemption when payment is confirmed,
 * and deleted when the order's reservation expires. Counted with usage so a
 * limit can never be oversubscribed.
 */
export const promotionHolds = pgTable(
  'promotion_holds',
  {
    id: id(),
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id),
    promotionCodeId: uuid('promotion_code_id').references(() => promotionCodes.id),
    customerId: uuid('customer_id').references(() => customers.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('promotion_holds_promotion_order_uq').on(t.promotionId, t.orderId),
    index('promotion_holds_code_idx').on(t.promotionCodeId),
    index('promotion_holds_customer_idx').on(t.promotionId, t.customerId),
    index('promotion_holds_order_idx').on(t.orderId),
  ],
);

export const orderPromotionCodes = pgTable(
  'order_promotion_codes',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    promotionCodeId: uuid('promotion_code_id')
      .notNull()
      .references(() => promotionCodes.id),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.promotionCodeId] })],
);

// ---------------------------------------------------------------- inventory

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: id(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    quantityDelta: integer('quantity_delta').notNull(),
    reason: text('reason').notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
    reference: text('reference'),
    createdAt: createdAt(),
  },
  (t) => [
    check('inventory_movements_nonzero', sql`${t.quantityDelta} <> 0`),
    index('inventory_movements_variant_idx').on(t.variantId, t.createdAt),
  ],
);

export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    quantity: integer('quantity').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    releasedAt: tstz('released_at'),
    consumedAt: tstz('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('stock_reservations_quantity_positive', sql`${t.quantity} > 0`),
    check('stock_reservations_not_both', sql`not (${t.releasedAt} is not null and ${t.consumedAt} is not null)`),
    uniqueIndex('stock_reservations_active_uq')
      .on(t.orderId, t.variantId)
      .where(sql`${t.releasedAt} is null and ${t.consumedAt} is null`),
    index('stock_reservations_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.releasedAt} is null and ${t.consumedAt} is null`),
  ],
);

// ------------------------------------------------------------------ payment

export const paymentMethod = pgEnum('payment_method', ['card', 'bank_transfer', 'ussd', 'pay_on_delivery', 'other']);
export const paymentAttemptStatus = pgEnum('payment_attempt_status', [
  'initializing',
  'pending',
  'succeeded',
  'failed',
  'expired',
  'refunded',
]);

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    provider: text('provider').notNull().default('paystack'),
    providerReference: text('provider_reference').notNull(),
    providerTransactionId: text('provider_transaction_id'),
    method: paymentMethod('method').notNull(),
    status: paymentAttemptStatus('status').notNull().default('initializing'),
    amountMinor: money('amount_minor').notNull(),
    currency: text('currency').notNull().default('NGN'),
    initializedAt: tstz('initialized_at'),
    paidAt: tstz('paid_at'),
    metadataRedacted: jsonb('metadata_redacted').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payment_attempts_amount_positive', sql`${t.amountMinor} > 0`),
    uniqueIndex('payment_attempts_provider_ref_uq').on(t.provider, t.providerReference),
    uniqueIndex('payment_attempts_provider_txn_uq')
      .on(t.provider, t.providerTransactionId)
      .where(sql`${t.providerTransactionId} is not null`),
    uniqueIndex('payment_attempts_one_active_uq')
      .on(t.orderId)
      .where(sql`${t.status} in ('initializing', 'pending')`),
    index('payment_attempts_order_created_idx').on(t.orderId, t.createdAt),
    index('payment_attempts_order_status_idx').on(t.orderId, t.status),
  ],
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    providerEventKey: text('provider_event_key').notNull(),
    receivedAt: tstz('received_at').notNull().defaultNow(),
    processedAt: tstz('processed_at'),
    processingStatus: text('processing_status').notNull().default('received'),
    payloadRedacted: jsonb('payload_redacted').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [uniqueIndex('payment_webhook_events_key_uq').on(t.provider, t.providerEventKey)],
);

export const orderStatusEvents = pgTable(
  'order_status_events',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('order_status_events_order_idx').on(t.orderId, t.createdAt)],
);

export const deliveries = pgTable('deliveries', {
  id: id(),
  orderId: uuid('order_id')
    .notNull()
    .unique()
    .references(() => orders.id),
  method: text('method').notNull(),
  zone: text('zone'),
  status: text('status').notNull().default('pending'),
  carrier: text('carrier'),
  riderName: text('rider_name'),
  riderPhoneE164: text('rider_phone_e164'),
  trackingReference: text('tracking_reference'),
  estimatedDeliveryAt: tstz('estimated_delivery_at'),
  deliveredAt: tstz('delivered_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    amountMinor: money('amount_minor').notNull(),
    reason: text('reason'),
    providerReference: text('provider_reference'),
    status: text('status').notNull().default('pending'),
    createdByAdminId: uuid('created_by_admin_id').references(() => adminUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('refunds_amount_positive', sql`${t.amountMinor} > 0`),
    index('refunds_order_idx').on(t.orderId),
  ],
);

export const returns = pgTable(
  'returns',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('requested'),
    itemsJson: jsonb('items_json').notNull(),
    requestedAt: tstz('requested_at').notNull().defaultNow(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [index('returns_order_idx').on(t.orderId)],
);
