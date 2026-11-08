import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createDatabase, type Database } from '../db/client.js';
import { storeSettings } from '../db/schema/index.js';

/** Integration tests run only when TEST_DATABASE_URL points at a disposable PostgreSQL server. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export type TestDatabase = Database & { name: string; destroy: () => Promise<void> };

/** Sales can only be collected through a payout subaccount, so test databases start with one connected. */
const TEST_PAYOUT_ACCOUNT = {
  subaccountCode: 'ACCT_test',
  businessName: "Jetty's Hairs",
  bankCode: '058',
  bankName: 'GTBank',
  accountName: 'JETTY HAIR LTD',
  accountLast4: '6789',
  percentageCharge: 0,
  feeBearer: 'account',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Creates an isolated, fully migrated database so test files can run in parallel. Pass `payoutAccount: false` for a
 * test that needs the shop with no payout account connected yet.
 */
export async function createTestDatabase({ payoutAccount = true }: { payoutAccount?: boolean } = {}): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');

  const name = `jetty_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1 });
  await admin.unsafe(`create database ${name}`);

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  // Test files run in parallel against one server (default limit: 100 connections), so each gets a small pool.
  const database = createDatabase(url.toString(), { max: 8 });
  await migrate(database.db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });

  if (payoutAccount) await database.db.insert(storeSettings).values({ key: 'app.payout_account', value: TEST_PAYOUT_ACCOUNT });

  return {
    ...database,
    name,
    destroy: async () => {
      await database.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
