import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createDatabase, type Database } from '../db/client.js';

/** Integration tests run only when TEST_DATABASE_URL points at a disposable PostgreSQL server. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export type TestDatabase = Database & { name: string; destroy: () => Promise<void> };

/** Creates an isolated, fully migrated database so test files can run in parallel. */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');

  const name = `jetty_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1 });
  await admin.unsafe(`create database ${name}`);

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const database = createDatabase(url.toString(), { max: 20 });
  await migrate(database.db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });

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
