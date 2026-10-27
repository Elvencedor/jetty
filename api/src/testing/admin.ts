import assert from 'node:assert/strict';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import type { Db } from '../db/client.js';
import { seed } from '../db/seed.js';
import { adminRoles, adminUserRoles, adminUsers } from '../db/schema/index.js';
import { hashPassword } from '../lib/password.js';

export const TEST_AUTH_SECRET = 'test-auth-secret-0123456789-abcdefghij';
export const ADMIN_PASSWORD = 'admin correct horse battery';

export const adminTestEnv = (extra: Record<string, string> = {}) =>
  loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error', AUTH_TOKEN_SECRET: TEST_AUTH_SECRET, PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN: 'noemail.test', ...extra });

let counter = 0;

/** Creates an admin with the given role and signs them in through the real login endpoint. */
export async function signInAdmin(db: Db, api: Server, role: 'owner' | 'manager' | 'fulfilment' | 'content_editor' | 'support' = 'owner') {
  await seed(db);
  const email = `admin${++counter}-${role}@example.com`;
  const [admin] = await db.insert(adminUsers).values({ email, passwordHash: await hashPassword(ADMIN_PASSWORD) }).returning();
  const [r] = await db.select().from(adminRoles).where(eq(adminRoles.name, role));
  await db.insert(adminUserRoles).values({ adminUserId: admin!.id, adminRoleId: r!.id });

  const res = await api.inject({ method: 'POST', url: '/api/v1/admin/auth/login', payload: { email, password: ADMIN_PASSWORD } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.result));
  const session = res.result as { accessToken: string; admin: { id: string } };
  return { id: session.admin.id, email, token: session.accessToken, headers: { authorization: `Bearer ${session.accessToken}` } };
}
