import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { adminRoles, adminSessions, adminUserRoles, adminUsers } from '../../db/schema/index.js';
import { apiError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { newOpaqueSecret, sameHash, sha256, signAccessToken, verifyAccessToken } from '../../lib/tokens.js';

export const ADMIN_ACCESS_TTL_S = 15 * 60;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// A separate key from customer tokens, so one kind of token can never stand in for the other.
const accessKey = (tokenSecret: string) => `${tokenSecret}:admin-access`;

const invalidCredentials = () => apiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
const invalidRefresh = () => apiError(401, 'INVALID_REFRESH_TOKEN', 'Your session has expired. Please sign in again.');

let decoy: Promise<string> | undefined;
const decoyHash = () => (decoy ??= hashPassword('decoy-password-never-matches'));

export type AdminIdentity = { id: string; email: string; roles: string[]; permissions: string[] };

type AdminRow = typeof adminUsers.$inferSelect;

async function identity(db: Db, admin: Pick<AdminRow, 'id' | 'email'>): Promise<AdminIdentity> {
  const rows = await db
    .select({ name: adminRoles.name, permissions: adminRoles.permissions })
    .from(adminUserRoles)
    .innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.adminRoleId))
    .where(eq(adminUserRoles.adminUserId, admin.id));
  const permissions = [...new Set(rows.flatMap((r) => (r.permissions as string[]) ?? []))].sort();
  return { id: admin.id, email: admin.email, roles: rows.map((r) => r.name).sort(), permissions };
}

/** `*` grants everything; holding `x:write` also grants `x:read`. */
export function permits(held: readonly string[], needed: string): boolean {
  if (held.includes('*') || held.includes(needed)) return true;
  return needed.endsWith(':read') && held.includes(`${needed.slice(0, -5)}:write`);
}

export type AdminSession = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  admin: AdminIdentity;
};

async function tokens(db: Db, tokenSecret: string, admin: AdminRow, sessionId: string, refreshSecret: string, now: Date): Promise<AdminSession> {
  return {
    accessToken: signAccessToken({ sub: admin.id, sid: sessionId, exp: Math.floor(now.getTime() / 1000) + ADMIN_ACCESS_TTL_S }, accessKey(tokenSecret)),
    expiresIn: ADMIN_ACCESS_TTL_S,
    refreshToken: `${sessionId}.${refreshSecret}`,
    admin: await identity(db, admin),
  };
}

/** Email and password. Unknown, disabled and wrong-password cases are indistinguishable in both response and timing. */
export async function login(db: Db, tokenSecret: string, input: { email: string; password: string }, now: Date = new Date()): Promise<AdminSession> {
  const [admin] = await db.select().from(adminUsers).where(eq(sql`lower(${adminUsers.email})`, input.email.trim().toLowerCase()));
  const ok = await verifyPassword(input.password, admin?.passwordHash ?? (await decoyHash()));
  if (!admin || !ok || admin.status !== 'active') throw invalidCredentials();

  const refreshSecret = newOpaqueSecret();
  const [session] = await db
    .insert(adminSessions)
    .values({ adminUserId: admin.id, refreshTokenHash: sha256(refreshSecret), expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_MS), lastUsedAt: now })
    .returning({ id: adminSessions.id });
  return tokens(db, tokenSecret, admin, session!.id, refreshSecret, now);
}

export async function refresh(db: Db, tokenSecret: string, presented: string, now: Date = new Date()): Promise<AdminSession> {
  const [sessionId, refreshSecret] = presented.split('.');
  if (!sessionId || !refreshSecret || !/^[0-9a-f-]{36}$/.test(sessionId)) throw invalidRefresh();

  const [row] = await db
    .select({ session: adminSessions, admin: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(eq(adminSessions.id, sessionId));
  if (!row || row.session.revokedAt || row.session.expiresAt <= now || row.admin.status !== 'active') throw invalidRefresh();
  if (!sameHash(row.session.refreshTokenHash, sha256(refreshSecret))) {
    // A rotated-out token was replayed, so the session is treated as stolen.
    await db.update(adminSessions).set({ revokedAt: now }).where(eq(adminSessions.id, sessionId));
    throw invalidRefresh();
  }

  const next = newOpaqueSecret();
  const rotated = await db
    .update(adminSessions)
    .set({ refreshTokenHash: sha256(next), lastUsedAt: now })
    .where(and(eq(adminSessions.id, sessionId), eq(adminSessions.refreshTokenHash, row.session.refreshTokenHash), isNull(adminSessions.revokedAt)))
    .returning({ id: adminSessions.id });
  if (rotated.length === 0) throw invalidRefresh();
  return tokens(db, tokenSecret, row.admin, sessionId, next, now);
}

export async function logout(db: Db, sessionId: string, now: Date = new Date()): Promise<void> {
  await db.update(adminSessions).set({ revokedAt: now }).where(and(eq(adminSessions.id, sessionId), isNull(adminSessions.revokedAt)));
}

/** Resolves an access token's session to the admin and their current permissions, or null if revoked/expired/disabled. */
export async function activeAdminSession(db: Db, tokenSecret: string, token: string, now: Date = new Date()): Promise<{ admin: AdminIdentity; sessionId: string } | null> {
  const claims = verifyAccessToken(token, accessKey(tokenSecret), now);
  if (!claims) return null;
  const [row] = await db
    .select({ admin: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(and(eq(adminSessions.id, claims.sid), eq(adminSessions.adminUserId, claims.sub), isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, now)));
  if (!row || row.admin.status !== 'active') return null;
  // Permissions are read per request, so a role change or disabled account takes effect immediately.
  return { admin: await identity(db, row.admin), sessionId: claims.sid };
}
