import { eq, sql } from 'drizzle-orm';
import { hashPassword } from '../lib/password.js';
import { createDatabase, type Db } from './client.js';
import {
  adminRoles,
  adminUserRoles,
  adminUsers,
  categories,
  collections,
  deliveryZones,
  storeSettings,
} from './schema/index.js';

const ALL = ['*'];

export const ROLE_PERMISSIONS = {
  owner: ALL,
  manager: ['catalog:write', 'orders:write', 'promotions:write', 'content:write', 'customers:read', 'analytics:read', 'inventory:write'],
  fulfilment: ['orders:read', 'orders:fulfil', 'inventory:read'],
  content_editor: ['content:write', 'catalog:read'],
  support: ['orders:read', 'customers:read', 'reviews:moderate'],
} as const;

export const CATEGORY_SEEDS = [
  ['frontal', 'Frontal'],
  ['closure', 'Closure'],
  ['glueless', 'Glueless'],
  ['bobs', 'Bobs'],
  ['coloured', 'Coloured'],
  ['hair-care', 'Hair care'],
  ['accessories', 'Accessories'],
] as const;

export const COLLECTION_SEEDS = [
  ['new-arrivals', 'New arrivals'],
  ['best-sellers', 'Best sellers'],
  ['on-offer', 'On offer'],
] as const;

// Allow-listed keys only; secrets never belong here.
export const SETTING_SEEDS: Record<string, unknown> = {
  'store.currency': 'NGN',
  'policies.return_window_days': 7,
  'checkout.reservation_minutes': 60,
};

export type SeedOptions = { ownerEmail?: string; ownerPassword?: string };

/** Idempotent: safe to re-run; never overwrites existing admin credentials or edited settings. */
export async function seed(db: Db, { ownerEmail, ownerPassword }: SeedOptions = {}): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [name, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      await tx
        .insert(adminRoles)
        .values({ name: name as keyof typeof ROLE_PERMISSIONS, permissions })
        .onConflictDoUpdate({ target: adminRoles.name, set: { permissions } });
    }

    for (const [i, [slug, name]] of CATEGORY_SEEDS.entries()) {
      await tx.insert(categories).values({ slug, name, sortOrder: i }).onConflictDoNothing();
    }
    for (const [i, [slug, name]] of COLLECTION_SEEDS.entries()) {
      await tx.insert(collections).values({ slug, name, sortOrder: i }).onConflictDoNothing();
    }

    for (const [key, value] of Object.entries(SETTING_SEEDS)) {
      await tx.insert(storeSettings).values({ key, value }).onConflictDoNothing();
    }

    // Fees are business data: seed the zone inactive so the owner must set rates before enabling it.
    const [zone] = await tx.select({ id: deliveryZones.id }).from(deliveryZones).limit(1);
    if (!zone) {
      await tx.insert(deliveryZones).values({
        name: 'Lagos',
        state: 'Lagos',
        active: false,
        sameDayCutoffLocal: '14:00',
        timezone: 'Africa/Lagos',
      });
    }

    if (ownerEmail && ownerPassword) {
      const [existing] = await tx
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(eq(sql`lower(${adminUsers.email})`, ownerEmail.toLowerCase()));
      const [ownerRole] = await tx.select({ id: adminRoles.id }).from(adminRoles).where(eq(adminRoles.name, 'owner'));
      if (!existing && ownerRole) {
        const [admin] = await tx
          .insert(adminUsers)
          .values({ email: ownerEmail, passwordHash: await hashPassword(ownerPassword) })
          .returning({ id: adminUsers.id });
        if (admin) await tx.insert(adminUserRoles).values({ adminUserId: admin.id, adminRoleId: ownerRole.id });
      }
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required to seed');
    process.exit(1);
  }
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if ((ownerEmail || ownerPassword) && (!ownerEmail || !ownerPassword || ownerPassword.length < 12)) {
    console.error('SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD (min 12 chars) must be set together');
    process.exit(1);
  }
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await seed(db, { ownerEmail, ownerPassword });
    console.log(ownerEmail ? 'Seed complete (owner ensured)' : 'Seed complete (no owner: SEED_OWNER_* not set)');
  } finally {
    await close();
  }
}
