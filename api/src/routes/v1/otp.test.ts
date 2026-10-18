import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { and, desc, eq } from 'drizzle-orm';
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

describe('phone OTP sign-in and password reset', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let phones = 0;
  const newPhone = () => `+23482${String(30_000_000 + ++phones)}`;
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
  const requestCode = async (phone: string) => assert.equal((await post('/auth/otp/request', { phone })).statusCode, 202);
  const registerWithPassword = async (phone: string, extra: Json = {}) => {
    const res = await post('/auth/register', { phone, password: PASSWORD, ...extra });
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    return body(res).accessToken as string;
  };
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

  describe('sign-in with a code', () => {
    it('creates a verified, passwordless account on first sign-in and a session that works', async () => {
      const phone = newPhone();
      const requested = await post('/auth/otp/request', { phone });
      assert.equal(requested.statusCode, 202);
      assert.deepEqual(body(requested), { expiresInSeconds: 600, resendAfterSeconds: 60 });
      assert.equal(requested.headers['cache-control'], 'no-store');

      const code = await lastCode(phone);
      assert.match(code, /^\d{6}$/);
      const verified = await post('/auth/otp/verify', { phone, code });
      assert.equal(verified.statusCode, 200, JSON.stringify(verified.result));
      assert.equal(body(verified).customer.phone, phone);
      assert.equal(body(verified).customer.phoneVerified, true);
      assert.match(String(verified.headers['set-cookie']), /jh_refresh=/);
      assert.equal((await me(body(verified).accessToken)).statusCode, 200);

      const [customer] = await t.db.select().from(customers).where(eq(customers.phoneE164, phone));
      assert.equal(customer!.passwordHash, null);
      assert.equal(customer!.email, null);
    });

    it('signs an existing verified customer in without creating another account', async () => {
      const phone = newPhone();
      await requestCode(phone);
      await post('/auth/otp/verify', { phone, code: await lastCode(phone) });
      await skipCooldown(phone);
      await requestCode(phone);
      assert.equal((await post('/auth/otp/verify', { phone, code: await lastCode(phone) })).statusCode, 200);
      assert.equal((await t.db.select().from(customers).where(eq(customers.phoneE164, phone))).length, 1);
    });

    it('stores only a keyed hash of the code, never the code', async () => {
      const phone = newPhone();
      await requestCode(phone);
      const code = await lastCode(phone);
      const [challenge] = await t.db.select().from(authChallenges).where(eq(authChallenges.identifier, phone));
      assert.ok(!challenge!.secretHash.includes(code));
      assert.match(challenge!.secretHash, /^[0-9a-f]{64}$/);
      assert.equal(challenge!.purpose, 'login');
    });

    it('rejects a wrong code, and a code is good for one sign-in only', async () => {
      const phone = newPhone();
      await requestCode(phone);
      const code = await lastCode(phone);
      const bad = await post('/auth/otp/verify', { phone, code: wrongCode(code) });
      assert.equal(bad.statusCode, 401);
      assert.equal(body(bad).error.code, 'INVALID_CODE');
      assert.equal((await post('/auth/otp/verify', { phone, code })).statusCode, 200);
      assert.equal(body(await post('/auth/otp/verify', { phone, code })).error.code, 'INVALID_CODE');
    });

    it('spends a code exactly once when it is submitted concurrently', async () => {
      const phone = newPhone();
      await requestCode(phone);
      const code = await lastCode(phone);
      const results = await Promise.all(Array.from({ length: 6 }, () => post('/auth/otp/verify', { phone, code })));
      assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
      assert.equal((await t.db.select().from(customers).where(eq(customers.phoneE164, phone))).length, 1);
    });

    it('locks a code after too many wrong guesses, even for the right code', async () => {
      const phone = newPhone();
      await requestCode(phone);
      const code = await lastCode(phone);
      for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal((await post('/auth/otp/verify', { phone, code: wrongCode(code) })).statusCode, 401);
      assert.equal(body(await post('/auth/otp/verify', { phone, code })).error.code, 'INVALID_CODE');
      assert.equal((await t.db.select().from(customers).where(eq(customers.phoneE164, phone))).length, 0, 'no account was created');
    });

    it('rejects an expired code', async () => {
      const phone = newPhone();
      await requestCode(phone);
      const code = await lastCode(phone);
      await t.db.update(authChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authChallenges.identifier, phone));
      assert.equal(body(await post('/auth/otp/verify', { phone, code })).error.code, 'INVALID_CODE');
    });

    it('invalidates the previous code when a new one is issued', async () => {
      const phone = newPhone();
      await requestCode(phone);
      const first = await lastCode(phone);
      await skipCooldown(phone);
      await requestCode(phone);
      const second = await lastCode(phone);
      if (first !== second) assert.equal(body(await post('/auth/otp/verify', { phone, code: first })).error.code, 'INVALID_CODE');
      assert.equal((await post('/auth/otp/verify', { phone, code: second })).statusCode, 200);
    });

    it('ignores repeat requests inside the cooldown instead of sending more texts', async () => {
      const phone = newPhone();
      await requestCode(phone);
      const first = await lastCode(phone);
      for (let i = 0; i < 3; i++) assert.equal((await post('/auth/otp/request', { phone })).statusCode, 202);
      assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, phone))).length, 1);
      assert.equal(await lastCode(phone), first);
    });

    it('sends only one text when requests race', async () => {
      const phone = newPhone();
      await Promise.all(Array.from({ length: 5 }, () => post('/auth/otp/request', { phone })));
      assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, phone))).length, 1);
    });

    it('keeps a code from one purpose from working for another', async () => {
      const phone = newPhone();
      await registerWithPassword(phone);
      await requestCode(phone);
      const loginCode = await lastCode(phone);
      const res = await post('/auth/password/reset', { phone, code: loginCode, password: NEW_PASSWORD });
      assert.equal(res.statusCode, 401);
      assert.equal(body(res).error.code, 'INVALID_CODE');
    });

    it('answers a blocked customer like a wrong code', async () => {
      const phone = newPhone();
      await registerWithPassword(phone);
      await t.db.update(customers).set({ status: 'blocked' }).where(eq(customers.phoneE164, phone));
      await requestCode(phone);
      const res = await post('/auth/otp/verify', { phone, code: await lastCode(phone) });
      assert.equal(res.statusCode, 401);
      assert.equal(body(res).error.code, 'INVALID_CODE');
    });

    it('validates the request bodies', async () => {
      assert.equal((await post('/auth/otp/request', { phone: '08012345678' })).statusCode, 422);
      assert.equal((await post('/auth/otp/request', {})).statusCode, 422);
      assert.equal((await post('/auth/otp/verify', { phone: newPhone(), code: '12345' })).statusCode, 422);
      assert.equal((await post('/auth/otp/verify', { phone: newPhone(), code: 'abcdef' })).statusCode, 422);
    });

    it('hands a password-registered account to whoever proves the phone, dropping the first registrant’s password and sessions', async () => {
      const phone = newPhone();
      // Someone registers a number they do not own, before its owner does.
      const squatter = await registerWithPassword(phone);
      assert.equal((await me(squatter)).statusCode, 200);

      await requestCode(phone);
      const owner = await post('/auth/otp/verify', { phone, code: await lastCode(phone) });
      assert.equal(owner.statusCode, 200);
      assert.equal((await me(squatter)).statusCode, 401, 'the squatter’s session is revoked');
      assert.equal((await post('/auth/login', { phone, password: PASSWORD })).statusCode, 401, 'and so is their password');
      assert.equal((await me(body(owner).accessToken)).statusCode, 200);
    });

    it('does not touch the password or sessions of an account whose phone was already verified', async () => {
      const phone = newPhone();
      await requestCode(phone);
      await post('/auth/otp/verify', { phone, code: await lastCode(phone) });
      // The owner sets a password through a reset, then signs in with it.
      await post('/auth/password/forgot', { phone });
      await skipCooldown(phone);
      await post('/auth/password/forgot', { phone });
      await post('/auth/password/reset', { phone, code: await lastCode(phone), password: NEW_PASSWORD });
      const session = await post('/auth/login', { phone, password: NEW_PASSWORD });
      assert.equal(session.statusCode, 200);

      await skipCooldown(phone);
      await requestCode(phone);
      assert.equal((await post('/auth/otp/verify', { phone, code: await lastCode(phone) })).statusCode, 200);
      assert.equal((await me(body(session).accessToken)).statusCode, 200);
      assert.equal((await post('/auth/login', { phone, password: NEW_PASSWORD })).statusCode, 200);
    });
  });

  describe('password reset', () => {
    it('does not reveal whether an account exists', async () => {
      const known = newPhone();
      await registerWithPassword(known);
      const unknown = newPhone();
      const a = await post('/auth/password/forgot', { phone: known });
      const b = await post('/auth/password/forgot', { phone: unknown });
      assert.equal(a.statusCode, 202);
      assert.equal(b.statusCode, 202);
      assert.deepEqual(a.result, b.result);
      assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, known))).length, 1);
      assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, unknown))).length, 0);
    });

    it('resets the password by phone, signs the account out everywhere and marks the phone verified', async () => {
      const phone = newPhone();
      const token = await registerWithPassword(phone);
      assert.equal((await post('/auth/password/forgot', { phone })).statusCode, 202);
      const code = await lastCode(phone);

      const reset = await post('/auth/password/reset', { phone, code, password: NEW_PASSWORD });
      assert.equal(reset.statusCode, 204, JSON.stringify(reset.result));
      assert.equal((await me(token)).statusCode, 401);
      assert.equal((await post('/auth/login', { phone, password: PASSWORD })).statusCode, 401);
      assert.equal((await post('/auth/login', { phone, password: NEW_PASSWORD })).statusCode, 200);
      const [customer] = await t.db.select().from(customers).where(eq(customers.phoneE164, phone));
      assert.ok(customer!.phoneVerifiedAt);
      assert.equal((await t.db.select().from(customerSessions).where(and(eq(customerSessions.customerId, customer!.id)))).filter((s) => s.revokedAt === null).length, 1);

      assert.equal((await post('/auth/password/reset', { phone, code, password: 'yet another password' })).statusCode, 401, 'the code is single-use');
    });

    it('works by email for accounts that registered one, sending the code by email', async () => {
      const phone = newPhone();
      const email = `reset-${phones}@example.com`;
      await registerWithPassword(phone, { email });
      assert.equal((await post('/auth/password/forgot', { email: email.toUpperCase() })).statusCode, 202);
      const [queued] = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, email));
      assert.equal(queued!.channel, 'email');
      assert.equal(queued!.eventType, 'auth.password_reset');

      const res = await post('/auth/password/reset', { email, code: await lastCode(email), password: NEW_PASSWORD });
      assert.equal(res.statusCode, 204);
      assert.equal((await post('/auth/login', { email, password: NEW_PASSWORD })).statusCode, 200);
      const [customer] = await t.db.select().from(customers).where(eq(customers.phoneE164, phone));
      assert.ok(customer!.emailVerifiedAt);
      assert.equal(customer!.phoneVerifiedAt, null, 'an email reset proves nothing about the phone');
    });

    it('lets a passwordless (code-only) account set a password', async () => {
      const phone = newPhone();
      await requestCode(phone);
      await post('/auth/otp/verify', { phone, code: await lastCode(phone) });
      await skipCooldown(phone);
      await post('/auth/password/forgot', { phone });
      assert.equal((await post('/auth/password/reset', { phone, code: await lastCode(phone), password: NEW_PASSWORD })).statusCode, 204);
      assert.equal((await post('/auth/login', { phone, password: NEW_PASSWORD })).statusCode, 200);
    });

    it('rejects a wrong code without changing the password, and enforces the new password rules', async () => {
      const phone = newPhone();
      await registerWithPassword(phone);
      await post('/auth/password/forgot', { phone });
      const code = await lastCode(phone);
      assert.equal((await post('/auth/password/reset', { phone, code: wrongCode(code), password: NEW_PASSWORD })).statusCode, 401);
      assert.equal((await post('/auth/password/reset', { phone, code, password: 'short' })).statusCode, 422);
      assert.equal((await post('/auth/login', { phone, password: PASSWORD })).statusCode, 200);
    });

    it('requires exactly one identifier', async () => {
      assert.equal((await post('/auth/password/forgot', {})).statusCode, 422);
      assert.equal((await post('/auth/password/forgot', { phone: newPhone(), email: 'a@example.com' })).statusCode, 422);
    });

    it('does not let a blocked account reset its way back in', async () => {
      const phone = newPhone();
      await registerWithPassword(phone);
      await post('/auth/password/forgot', { phone });
      const code = await lastCode(phone);
      await t.db.update(customers).set({ status: 'blocked' }).where(eq(customers.phoneE164, phone));
      assert.equal((await post('/auth/password/reset', { phone, code, password: NEW_PASSWORD })).statusCode, 401);
    });
  });

  describe('delivery and housekeeping', () => {
    it('delivers the code by SMS through the outbox processor and then scrubs it', async () => {
      const phone = newPhone();
      await requestCode(phone);
      const code = await lastCode(phone);
      const sent: Message[] = [];
      const sms: Sender = { name: 'fake', send: async (m) => (sent.push(m), { providerMessageId: 'sms-1' }) };
      await t.db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 5000) }).where(eq(notificationOutbox.recipient, phone));
      await processOutbox(t.db, { sms, email: sms }, createLogger('error'));
      const message = sent.find((m) => m.to === phone);
      assert.ok(message, 'the code was texted');
      assert.ok(message!.text.includes(code));
      assert.match(message!.text, /expires in 10 minutes/);

      const [row] = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, phone));
      assert.equal(row!.status, 'sent');
      assert.deepEqual(row!.payload, {});
    });

    it('removes expired challenges and expires codes that never reached the customer', async () => {
      const phone = newPhone();
      await requestCode(phone);
      await t.db.update(authChallenges).set({ expiresAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(authChallenges.identifier, phone));
      assert.ok((await cleanupChallenges(t.db)) >= 1);
      assert.equal((await t.db.select().from(authChallenges).where(eq(authChallenges.identifier, phone))).length, 0);

      const stuck = newPhone();
      await requestCode(stuck);
      await t.db.update(notificationOutbox).set({ createdAt: new Date(Date.now() - 3_600_000) }).where(eq(notificationOutbox.recipient, stuck));
      assert.ok((await scrubStaleCodes(t.db)) >= 1);
      const [row] = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, stuck));
      assert.equal(row!.status, 'failed');
      assert.deepEqual(row!.payload, {});
    });
  });
});
