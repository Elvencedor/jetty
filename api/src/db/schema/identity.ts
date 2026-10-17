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
import { createdAt, id, tstz, updatedAt } from './_helpers.js';

export const customerStatus = pgEnum('customer_status', ['active', 'blocked', 'pending_verification']);
export const adminStatus = pgEnum('admin_status', ['active', 'disabled', 'invited']);

export const customers = pgTable(
  'customers',
  {
    id: id(),
    email: text('email'),
    phoneE164: text('phone_e164'),
    passwordHash: text('password_hash'),
    status: customerStatus('status').notNull().default('pending_verification'),
    emailVerifiedAt: tstz('email_verified_at'),
    phoneVerifiedAt: tstz('phone_verified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('customers_contact_present', sql`${t.email} is not null or ${t.phoneE164} is not null`),
    uniqueIndex('customers_email_lower_uq').on(sql`lower(${t.email})`).where(sql`${t.email} is not null`),
    uniqueIndex('customers_phone_uq').on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
  ],
);

export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: id(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    createdAt: createdAt(),
    lastUsedAt: tstz('last_used_at'),
  },
  (t) => [index('customer_sessions_customer_idx').on(t.customerId)],
);

export const authChallenges = pgTable(
  'auth_challenges',
  {
    id: id(),
    customerId: uuid('customer_id').references(() => customers.id),
    identifier: text('identifier').notNull(),
    purpose: text('purpose').notNull(),
    secretHash: text('secret_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    consumedAt: tstz('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('auth_challenges_attempts_nonneg', sql`${t.attemptCount} >= 0`),
    index('auth_challenges_identifier_idx').on(t.identifier, t.purpose, t.createdAt),
    index('auth_challenges_expires_idx').on(t.expiresAt),
  ],
);

export const customerPreferences = pgTable('customer_preferences', {
  customerId: uuid('customer_id')
    .primaryKey()
    .references(() => customers.id),
  emailMarketing: boolean('email_marketing').notNull().default(false),
  whatsappMarketing: boolean('whatsapp_marketing').notNull().default(false),
  smsMarketing: boolean('sms_marketing').notNull().default(false),
  emailConsentAt: tstz('email_consent_at'),
  whatsappConsentAt: tstz('whatsapp_consent_at'),
  smsConsentAt: tstz('sms_consent_at'),
  consentSource: text('consent_source'),
  updatedAt: updatedAt(),
});

export const addresses = pgTable(
  'addresses',
  {
    id: id(),
    customerId: uuid('customer_id').references(() => customers.id),
    recipientName: text('recipient_name').notNull(),
    phoneE164: text('phone_e164'),
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    landmark: text('landmark'),
    area: text('area'),
    city: text('city').notNull(),
    state: text('state').notNull(),
    postalCode: text('postal_code'),
    countryCode: text('country_code').notNull().default('NG'),
    riderNote: text('rider_note'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('addresses_customer_default_idx').on(t.customerId, t.isDefault)],
);

export const adminUsers = pgTable(
  'admin_users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: adminStatus('status').notNull().default('active'),
    twoFactorSecretEncrypted: text('two_factor_secret_encrypted'),
    twoFactorEnabledAt: tstz('two_factor_enabled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('admin_users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: id(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    createdAt: createdAt(),
    lastUsedAt: tstz('last_used_at'),
  },
  (t) => [index('admin_sessions_admin_idx').on(t.adminUserId)],
);

export const adminRecoveryCodes = pgTable(
  'admin_recovery_codes',
  {
    id: id(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id),
    codeHash: text('code_hash').notNull(),
    consumedAt: tstz('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('admin_recovery_codes_admin_idx').on(t.adminUserId)],
);

export const adminRoleName = pgEnum('admin_role_name', [
  'owner',
  'manager',
  'fulfilment',
  'content_editor',
  'support',
]);

export const adminRoles = pgTable('admin_roles', {
  id: id(),
  name: adminRoleName('name').notNull().unique(),
  permissions: jsonb('permissions').notNull().default(sql`'[]'::jsonb`),
});

export const adminUserRoles = pgTable(
  'admin_user_roles',
  {
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id),
    adminRoleId: uuid('admin_role_id')
      .notNull()
      .references(() => adminRoles.id),
  },
  (t) => [primaryKey({ columns: [t.adminUserId, t.adminRoleId] })],
);

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: id(),
    adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_audit_log_resource_idx').on(t.resourceType, t.resourceId),
    index('admin_audit_log_created_idx').on(t.createdAt),
  ],
);
