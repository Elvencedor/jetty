import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { desc, eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import { authChallenges, customerSessions, customers, notificationOutbox } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { MAX_ATTEMPTS, RESEND_COOLDOWN_MS, cleanupChallenges, scrubStaleCodes } from '../../modules/auth/challenges.js';
import { processOutbox } from '../../modules/notifications/process.js';
import type { Message, Sender } from '../../modules/notifications/senders.js';
import { createServer } from '../../server.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';

type Json = Record<string, any>;
const AUTH_SECRET = 'test-auth-secret-0123456789-abcdefghij';
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a brand new password';

describe('password reset by email', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let n = 0;
  const newEmail = () => `reset-${++n}@example.com`;
  const post = (url: string, payload: Json) => api.inject({ method: 'POST', url: `/api/v1${url}`, payload });
  const body = (res: { result: unknown }) => res.result as Json;

  /** The code the customer would receive, read from the queued message. */
  const lastCode = async (recipient: string) => {
    const [row] = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, recipient)).orderBy(desc(notificationOutbox.createdAt)).limit(1);
    const code = (row?.payload as Json | undefined)?.code;
    assert.equal(typeof code, 'string', 'a code was queued');
    return code as string;
  };
  /** Moves the cooldown out of the way so a second code can be requested in a test. */
  const skipCooldown = (identifier: string) =>
    t.db.update(authChallenges).set({ createdAt: new Date(Date.now() - RESEND_COOLDOWN_MS - 1000) }).where(eq(authChallenges.identifier, identifier));
  const wrongCode = (code: string) => (code === '000000' ? '000001' : '000000');
  const registerWithPassword = async (email: string, extra: Json = {}) => {
    const res = await post('/auth/register', { email, password: PASSWORD, ...extra });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    return body(res).accessToken as string;
  };
  const requestReset = async (email: string) => assert.equal((await post('/auth/password/forgot', { email })).statusCode, 202);
  const me = (token: string) => api.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } });

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({
      env: loadEnv({ NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'error', AUTH_TOKEN_SECRET: AUTH_SECRET }),
      logger: createLogger('error'),
      database: t,
    });
    await api.initialize();
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  it('does not reveal whether an account exists', async () => {
    const known = newEmail();
    await registerWithPassword(known);
    const unknown = newEmail();
    const a = await post('/auth/password/forgot', { email: known });
    const b = await post('/auth/password/forgot', { email: unknown });
    assert.equal(a.statusCode, 202);
    assert.equal(b.statusCode, 202);
    assert.deepEqual(a.result, b.result);
    assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, known))).length, 1);
    assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, unknown))).length, 0);
  });

  it('resets the password, signs the account out everywhere and marks the email verified', async () => {
    const email = newEmail();
    const token = await registerWithPassword(email);
    await requestReset(email.toUpperCase());
    const [queued] = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, email));
    assert.equal(queued!.channel, 'email');
    assert.equal(queued!.eventType, 'auth.password_reset');
    const code = await lastCode(email);

    const reset = await post('/auth/password/reset', { email, code, password: NEW_PASSWORD });
    assert.equal(reset.statusCode, 204, JSON.stringify(reset.result));
    assert.equal((await me(token)).statusCode, 401);
    assert.equal((await post('/auth/login', { email, password: PASSWORD })).statusCode, 401);
    assert.equal((await post('/auth/login', { email, password: NEW_PASSWORD })).statusCode, 200);
    const [customer] = await t.db.select().from(customers).where(eq(customers.email, email));
    assert.ok(customer!.emailVerifiedAt);
    assert.equal((await t.db.select().from(customerSessions).where(eq(customerSessions.customerId, customer!.id))).filter((s) => s.revokedAt === null).length, 1);

    assert.equal((await post('/auth/password/reset', { email, code, password: 'yet another password' })).statusCode, 401, 'the code is single-use');
  });

  it('stores only a keyed hash of the code, never the code', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await requestReset(email);
    const code = await lastCode(email);
    const [challenge] = await t.db.select().from(authChallenges).where(eq(authChallenges.identifier, email));
    assert.ok(!challenge!.secretHash.includes(code));
    assert.match(challenge!.secretHash, /^[0-9a-f]{64}$/);
    assert.equal(challenge!.purpose, 'password_reset');
  });

  it('rejects a wrong code without changing the password, and enforces the new password rules', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await requestReset(email);
    const code = await lastCode(email);
    const bad = await post('/auth/password/reset', { email, code: wrongCode(code), password: NEW_PASSWORD });
    assert.equal(bad.statusCode, 401);
    assert.equal(body(bad).error.code, 'INVALID_CODE');
    assert.equal((await post('/auth/password/reset', { email, code, password: 'short' })).statusCode, 422);
    assert.equal((await post('/auth/login', { email, password: PASSWORD })).statusCode, 200);
  });

  it('spends a code exactly once when it is submitted concurrently', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await requestReset(email);
    const code = await lastCode(email);
    const results = await Promise.all(Array.from({ length: 6 }, () => post('/auth/password/reset', { email, code, password: NEW_PASSWORD })));
    assert.equal(results.filter((r) => r.statusCode === 204).length, 1);
  });

  it('locks a code after too many wrong guesses, even for the right code', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await requestReset(email);
    const code = await lastCode(email);
    for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal((await post('/auth/password/reset', { email, code: wrongCode(code), password: NEW_PASSWORD })).statusCode, 401);
    assert.equal(body(await post('/auth/password/reset', { email, code, password: NEW_PASSWORD })).error.code, 'INVALID_CODE');
    assert.equal((await post('/auth/login', { email, password: PASSWORD })).statusCode, 200, 'the password was not changed');
  });

  it('rejects an expired code', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await requestReset(email);
    const code = await lastCode(email);
    await t.db.update(authChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authChallenges.identifier, email));
    assert.equal(body(await post('/auth/password/reset', { email, code, password: NEW_PASSWORD })).error.code, 'INVALID_CODE');
  });

  it('invalidates the previous code when a new one is issued', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await requestReset(email);
    const first = await lastCode(email);
    await skipCooldown(email);
    await requestReset(email);
    const second = await lastCode(email);
    if (first !== second) assert.equal(body(await post('/auth/password/reset', { email, code: first, password: NEW_PASSWORD })).error.code, 'INVALID_CODE');
    assert.equal((await post('/auth/password/reset', { email, code: second, password: NEW_PASSWORD })).statusCode, 204);
  });

  it('ignores repeat requests inside the cooldown instead of sending more emails', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await requestReset(email);
    const first = await lastCode(email);
    for (let i = 0; i < 3; i++) await requestReset(email);
    assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, email))).length, 1);
    assert.equal(await lastCode(email), first);
  });

  it('sends only one email when requests race', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await Promise.all(Array.from({ length: 5 }, () => post('/auth/password/forgot', { email })));
    assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, email))).length, 1);
  });

  it('does not let a blocked account reset its way back in', async () => {
    const email = newEmail();
    await registerWithPassword(email);
    await requestReset(email);
    const code = await lastCode(email);
    await t.db.update(customers).set({ status: 'blocked' }).where(eq(customers.email, email));
    assert.equal((await post('/auth/password/reset', { email, code, password: NEW_PASSWORD })).statusCode, 401);
  });

  it('takes an email only, and phone sign-in codes no longer exist', async () => {
    assert.equal((await post('/auth/password/forgot', {})).statusCode, 422);
    assert.equal((await post('/auth/password/forgot', { phone: '+2348012345678' })).statusCode, 422);
    assert.equal((await post('/auth/password/reset', { email: newEmail(), code: '12345', password: NEW_PASSWORD })).statusCode, 422);
    assert.equal((await post('/auth/otp/request', { phone: '+2348012345678' })).statusCode, 404);
    assert.equal((await post('/auth/otp/verify', { phone: '+2348012345678', code: '123456' })).statusCode, 404);
  });

  describe('delivery and housekeeping', () => {
    it('delivers the code by email through the outbox processor and then scrubs it', async () => {
      const email = newEmail();
      await registerWithPassword(email);
      await requestReset(email);
      const code = await lastCode(email);
      const sent: Message[] = [];
      const sender: Sender = { name: 'fake', send: async (m) => (sent.push(m), { providerMessageId: 'mail-1' }) };
      await t.db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 5000) }).where(eq(notificationOutbox.recipient, email));
      await processOutbox(t.db, { sms: sender, email: sender }, createLogger('error'));
      const message = sent.find((m) => m.to === email);
      assert.ok(message, 'the code was emailed');
      assert.ok(message!.text.includes(code));

      const [row] = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, email));
      assert.equal(row!.status, 'sent');
      assert.deepEqual(row!.payload, {});
    });

    it('removes expired challenges and expires codes that never reached the customer', async () => {
      const email = newEmail();
      await registerWithPassword(email);
      await requestReset(email);
      await t.db.update(authChallenges).set({ expiresAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(authChallenges.identifier, email));
      assert.ok((await cleanupChallenges(t.db)) >= 1);
      assert.equal((await t.db.select().from(authChallenges).where(eq(authChallenges.identifier, email))).length, 0);

      const stuck = newEmail();
      await registerWithPassword(stuck);
      await requestReset(stuck);
      await t.db.update(notificationOutbox).set({ createdAt: new Date(Date.now() - 3_600_000) }).where(eq(notificationOutbox.recipient, stuck));
      assert.ok((await scrubStaleCodes(t.db)) >= 1);
      const [row] = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, stuck));
      assert.equal(row!.status, 'failed');
      assert.deepEqual(row!.payload, {});
    });
  });
});
