import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required to run migrations');
  process.exit(1);
}

const { db, close } = createDatabase(url, { max: 1 });
try {
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  console.log('Migrations applied');
} finally {
  await close();
}
