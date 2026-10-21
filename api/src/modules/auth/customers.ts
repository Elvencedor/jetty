import { and, eq, isNull, gt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { customerSessions, customers } from '../../db/schema/index.js';
import { apiError, conflict } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { consumeChallenge, issueChallenge } from './challenges.js';
import { newOpaqueSecret, sha256, sameHash, signAccessToken } from '../../lib/tokens.js';
import { uniqueViolation } from '../../lib/sql.js';

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Customer = typeof customers.$inferSelect;

export const profile = (c: Customer) => ({
  id: c.id,
  phone: c.phoneE164,
  email: c.email,
  emailVerified: c.emailVerifiedAt !== null,
  phoneVerified: c.phoneVerifiedAt !== null,
  createdAt: c.createdAt,
});

export type Issued = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  customer: ReturnType<typeof profile>;
};

const invalidCredentials = () => apiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
const invalidRefresh = () => apiError(401, 'INVALID_REFRESH_TOKEN', 'Your session has expired. Please sign in again.');

// Verified against when the account does not exist, so response time does not reveal which emails are registered.
let decoy: Promise<string> | undefined;
const decoyHash = () => (decoy ??= hashPassword('decoy-password-never-matches'));

async function issue(db: Db, customer: Customer, secret: string, now: Date): Promise<Issued> {
  const refreshSecret = newOpaqueSecret();
  const [session] = await db
    .insert(customerSessions)
    .values({
      customerId: customer.id,
      refreshTokenHash: sha256(refreshSecret),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
      lastUsedAt: now,
    })
    .returning({ id: customerSessions.id });
  return tokens(customer, session!.id, refreshSecret, secret, now);
}

function tokens(customer: Customer, sessionId: string, refreshSecret: string, secret: string, now: Date): Issued {
  const exp = Math.floor(now.getTime() / 1000) + ACCESS_TOKEN_TTL_S;
  return {
    accessToken: signAccessToken({ sub: customer.id, sid: sessionId, exp }, secret),
    expiresIn: ACCESS_TOKEN_TTL_S,
    refreshToken: `${sessionId}.${refreshSecret}`,
    customer: profile(customer),
  };
}

export async function register(
  db: Db,
  secret: string,
  input: { email: string; password: string; phone?: string | undefined },
  now: Date = new Date(),
): Promise<Issued> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  let customer: Customer;
  try {
    [customer] = (await db
      .insert(customers)
      .values({ email, phoneE164: input.phone ?? null, passwordHash, status: 'active' })
      .returning()) as [Customer];
  } catch (err) {
    if (uniqueViolation(err)) {
      throw conflict('ACCOUNT_EXISTS', 'An account with these details already exists. Try signing in.');
    }
    throw err;
  }
  return issue(db, customer, secret, now);
}

export async function login(db: Db, secret: string, input: { email: string; password: string }, now: Date = new Date()): Promise<Issued> {
  const [customer] = await db.select().from(customers).where(sql`lower(${customers.email}) = ${input.email.trim().toLowerCase()}`);
  const ok = await verifyPassword(input.password, customer?.passwordHash ?? (await decoyHash()));
  if (!customer || !customer.passwordHash || !ok || customer.status === 'blocked') throw invalidCredentials();
  return issue(db, customer, secret, now);
}

/**
 * Rotates the refresh token. Presenting a token that is no longer current
 * means it was copied (or replayed after rotation), so the whole session is
 * revoked and both parties must sign in again.
 */
export async function refresh(db: Db, secret: string, presented: string, now: Date = new Date()): Promise<Issued> {
  const [sessionId, refreshSecret] = presented.split('.');
  if (!sessionId || !refreshSecret || !/^[0-9a-f-]{36}$/.test(sessionId)) throw invalidRefresh();

  const [row] = await db
    .select({ session: customerSessions, customer: customers })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .where(eq(customerSessions.id, sessionId));
  if (!row || row.session.revokedAt || row.session.expiresAt <= now) throw invalidRefresh();
  if (!sameHash(row.session.refreshTokenHash, sha256(refreshSecret))) {
    await db.update(customerSessions).set({ revokedAt: now }).where(eq(customerSessions.id, sessionId));
    throw invalidRefresh();
  }
  if (row.customer.status === 'blocked') throw invalidRefresh();

  const next = newOpaqueSecret();
  const rotated = await db
    .update(customerSessions)
    .set({ refreshTokenHash: sha256(next), lastUsedAt: now })
    .where(and(eq(customerSessions.id, sessionId), eq(customerSessions.refreshTokenHash, row.session.refreshTokenHash), isNull(customerSessions.revokedAt)))
    .returning({ id: customerSessions.id });
  if (rotated.length === 0) throw invalidRefresh();
  return tokens(row.customer, sessionId, next, secret, now);
}

export async function logout(db: Db, sessionId: string, now: Date = new Date()): Promise<void> {
  await db.update(customerSessions).set({ revokedAt: now }).where(and(eq(customerSessions.id, sessionId), isNull(customerSessions.revokedAt)));
}

/** Resolves a verified access token's session to its customer, or null if revoked/expired/blocked. */
export async function activeSession(db: Db, sessionId: string, customerId: string, now: Date = new Date()): Promise<Customer | null> {
  const [row] = await db
    .select({ customer: customers })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .where(and(eq(customerSessions.id, sessionId), eq(customerSessions.customerId, customerId), isNull(customerSessions.revokedAt), gt(customerSessions.expiresAt, now)));
  return row && row.customer.status !== 'blocked' ? row.customer : null;
}


const revokeSessions = (db: Db, customerId: string, now: Date) =>
  db.update(customerSessions).set({ revokedAt: now }).where(and(eq(customerSessions.customerId, customerId), isNull(customerSessions.revokedAt)));

/** Sends a reset code to the account's own email. Unknown, blocked and cooling-down requests return silently. */
export async function requestPasswordReset(db: Db, secret: string, input: { email: string }, now: Date = new Date()): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const [customer] = await db.select().from(customers).where(sql`lower(${customers.email}) = ${email}`);
  if (!customer || customer.status === 'blocked') return;
  await issueChallenge(db, secret, { purpose: 'password_reset', identifier: email, channel: 'email', customerId: customer.id }, now);
}

/** Sets a new password with a reset code, marks the email as verified (the code proved it), and signs the account out everywhere. */
export async function resetPassword(db: Db, secret: string, input: { email: string; code: string; password: string }, now: Date = new Date()): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const { customerId } = await consumeChallenge(db, secret, { purpose: 'password_reset', identifier: email, code: input.code }, now);
  if (!customerId) throw apiError(401, 'INVALID_CODE', 'The code is incorrect or has expired.');

  const updated = await db
    .update(customers)
    .set({ passwordHash, emailVerifiedAt: now, updatedAt: now })
    .where(and(eq(customers.id, customerId), sql`${customers.status} <> 'blocked'`))
    .returning({ id: customers.id });
  if (updated.length === 0) throw apiError(401, 'INVALID_CODE', 'The code is incorrect or has expired.');
  await revokeSessions(db, customerId, now);
}
