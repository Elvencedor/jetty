import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../../config/env.js';
import { notificationOutbox } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { createSenders, ResendSender, TermiiSender } from './providers.js';
import { MAX_ATTEMPTS, oldestPendingSeconds, processOutbox } from './process.js';
import { PermanentSendError, TransientSendError, type Message, type Sender, type Senders } from './senders.js';

class FakeSender implements Sender {
  readonly name = 'fake';
  sent: Message[] = [];
  failWith: Error | null = null;
  async send(message: Message) {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    return { providerMessageId: `msg-${this.sent.length}` };
  }
}

const logger = createLogger('error');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('notification outbox processor', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  const sms = new FakeSender();
  const email = new FakeSender();
  const senders: Senders = { sms, email };

  const enqueue = async (values: Partial<typeof notificationOutbox.$inferInsert> = {}) => {
    const [row] = await t.db
      .insert(notificationOutbox)
      .values({ eventType: 'order.placed', recipient: '+2348011111111', channel: 'sms', payload: { orderNumber: 'JH-1' }, nextAttemptAt: new Date(Date.now() - 5000), ...values })
      .returning();
    return row!;
  };
  const load = async (id: string) => (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.id, id)))[0]!;

  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t?.destroy();
  });
  beforeEach(async () => {
    await t.db.delete(notificationOutbox);
    sms.sent = [];
    email.sent = [];
    sms.failWith = null;
    email.failWith = null;
  });

  it('sends due rows through the right channel and records the provider message id', async () => {
    const a = await enqueue();
    const b = await enqueue({ channel: 'email', recipient: 'ada@example.com' });
    const result = await processOutbox(t.db, senders, logger);
    assert.deepEqual(result, { sent: 2, retried: 0, failed: 0 });
    assert.equal(sms.sent[0]!.to, '+2348011111111');
    assert.match(sms.sent[0]!.text, /JH-1/);
    assert.equal(email.sent[0]!.to, 'ada@example.com');
    assert.match(email.sent[0]!.subject!, /JH-1/);
    const row = await load(a.id);
    assert.equal(row.status, 'sent');
    assert.ok(row.sentAt);
    assert.equal(row.attemptCount, 1);
    assert.ok(row.providerMessageId?.startsWith('msg-'));
    assert.equal((await load(b.id)).status, 'sent');
  });

  it('leaves rows that are not due yet and sends nothing twice', async () => {
    const future = await enqueue({ nextAttemptAt: new Date(Date.now() + 60_000) });
    await enqueue();
    assert.equal((await processOutbox(t.db, senders, logger)).sent, 1);
    assert.equal((await processOutbox(t.db, senders, logger)).sent, 0);
    assert.equal((await load(future.id)).status, 'pending');
    assert.equal(sms.sent.length, 1);
  });

  it('delivers once when several workers run at the same time', async () => {
    for (let i = 0; i < 10; i++) await enqueue({ payload: { orderNumber: `JH-${i}` } });
    const results = await Promise.all([1, 2, 3, 4].map(() => processOutbox(t.db, senders, logger)));
    assert.equal(results.reduce((sum, r) => sum + r.sent, 0), 10);
    assert.equal(sms.sent.length, 10);
    assert.equal(new Set(sms.sent.map((m) => m.text)).size, 10);
  });

  it('retries transient failures with growing backoff and then succeeds', async () => {
    const row = await enqueue();
    sms.failWith = new TransientSendError('provider responded 503');
    const t0 = new Date();
    assert.deepEqual(await processOutbox(t.db, senders, logger, t0), { sent: 0, retried: 1, failed: 0 });
    let after1 = await load(row.id);
    assert.equal(after1.status, 'pending');
    assert.match(after1.lastError!, /503/);
    const wait1 = after1.nextAttemptAt.getTime() - t0.getTime();
    assert.ok(wait1 >= 29_000 && wait1 <= 31_000, `first backoff was ${wait1}`);

    // Not due again until the backoff has passed.
    assert.equal((await processOutbox(t.db, senders, logger, new Date(t0.getTime() + 10_000))).retried, 0);
    const t1 = new Date(t0.getTime() + 31_000);
    await processOutbox(t.db, senders, logger, t1);
    after1 = await load(row.id);
    const wait2 = after1.nextAttemptAt.getTime() - t1.getTime();
    assert.ok(wait2 >= 59_000 && wait2 <= 61_000, `second backoff was ${wait2}`);

    sms.failWith = null;
    assert.equal((await processOutbox(t.db, senders, logger, new Date(t1.getTime() + 61_000))).sent, 1);
    const done = await load(row.id);
    assert.equal(done.status, 'sent');
    assert.equal(done.attemptCount, 3);
    assert.equal(done.lastError, null);
  });

  it('fails permanently on a provider rejection, without retrying', async () => {
    const row = await enqueue();
    sms.failWith = new PermanentSendError('invalid number');
    assert.deepEqual(await processOutbox(t.db, senders, logger), { sent: 0, retried: 0, failed: 1 });
    const failed = await load(row.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.lastError, 'invalid number');
    assert.deepEqual(await processOutbox(t.db, senders, logger, new Date(Date.now() + 3_600_000)), { sent: 0, retried: 0, failed: 0 });
  });

  it('gives up after the maximum number of attempts and keeps the last error visible', async () => {
    const row = await enqueue();
    sms.failWith = new TransientSendError('timeout');
    let now = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await processOutbox(t.db, senders, logger, new Date(now));
      now += 2 * 3_600_000;
    }
    const failed = await load(row.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.attemptCount, MAX_ATTEMPTS);
    assert.match(failed.lastError!, /timeout/);
  });

  it('picks a row up again when the worker that claimed it died, and stops after too many lost claims', async () => {
    const row = await enqueue();
    const t0 = new Date();
    // Simulate a worker that claimed the row and crashed before sending.
    await t.db.update(notificationOutbox).set({ status: 'sending', attemptCount: 1, nextAttemptAt: new Date(t0.getTime() + 120_000) }).where(eq(notificationOutbox.id, row.id));
    assert.equal((await processOutbox(t.db, senders, logger, new Date(t0.getTime() + 60_000))).sent, 0, 'still leased');
    assert.equal((await processOutbox(t.db, senders, logger, new Date(t0.getTime() + 121_000))).sent, 1);
    assert.equal((await load(row.id)).attemptCount, 2);

    const stuck = await enqueue();
    await t.db.update(notificationOutbox).set({ status: 'sending', attemptCount: MAX_ATTEMPTS, nextAttemptAt: new Date(t0.getTime() - 1000) }).where(eq(notificationOutbox.id, stuck.id));
    assert.equal((await processOutbox(t.db, senders, logger, t0)).failed, 1);
    assert.equal((await load(stuck.id)).status, 'failed');
  });

  it('fails rows it cannot render instead of retrying them forever', async () => {
    const unknown = await enqueue({ eventType: 'mystery.event' });
    const broken = await enqueue({ payload: {} });
    const channel = await enqueue({ channel: 'carrier-pigeon' });
    assert.equal((await processOutbox(t.db, senders, logger)).failed, 3);
    assert.match((await load(unknown.id)).lastError!, /no template/);
    assert.equal((await load(broken.id)).status, 'failed');
    assert.match((await load(channel.id)).lastError!, /unknown channel/);
    assert.equal(sms.sent.length, 0);
  });

  it('marks internal operations alerts as handled without sending them to customers', async () => {
    const alert = await enqueue({ eventType: 'payment.exception', recipient: 'operations', channel: 'internal', payload: { orderNumber: 'JH-9', reason: 'amount mismatch' } });
    assert.equal((await processOutbox(t.db, senders, logger)).sent, 1);
    assert.equal((await load(alert.id)).status, 'sent');
    assert.equal(sms.sent.length + email.sent.length, 0);
  });

  it('removes one-time codes from the payload once the message is sent or has failed', async () => {
    const ok = await enqueue({ eventType: 'auth.otp', payload: { code: '123456' } });
    await processOutbox(t.db, senders, logger);
    assert.match(sms.sent[0]!.text, /123456/);
    assert.deepEqual((await load(ok.id)).payload, {});

    sms.failWith = new PermanentSendError('invalid number');
    const bad = await enqueue({ eventType: 'auth.password_reset', payload: { code: '654321' } });
    await processOutbox(t.db, senders, logger);
    assert.deepEqual((await load(bad.id)).payload, {});

    // A code waiting for a retry is kept, because it still has to be sent.
    sms.failWith = new TransientSendError('timeout');
    const waiting = await enqueue({ eventType: 'auth.otp', payload: { code: '111111' } });
    await processOutbox(t.db, senders, logger);
    assert.deepEqual((await load(waiting.id)).payload, { code: '111111' });
  });

  it('reports how long the oldest due message has waited', async () => {
    assert.equal(await oldestPendingSeconds(t.db), 0);
    await enqueue({ nextAttemptAt: new Date(Date.now() - 400_000) });
    const age = await oldestPendingSeconds(t.db);
    assert.ok(age >= 399 && age <= 405, `age was ${age}`);
  });
});

describe('notification providers', () => {
  it('Termii sends the number without a plus sign and returns the message id', async () => {
    let call: { url: string; body: Record<string, string> } | undefined;
    const sender = new TermiiSender({ apiKey: 'key', senderId: 'Jettys', baseUrl: 'https://sms.test' }, async (url, init) => {
      call = { url: String(url), body: JSON.parse(String(init?.body)) };
      return json(200, { message_id: 'abc', code: 'ok' });
    });
    const result = await sender.send({ to: '+2348012345678', text: 'hello' });
    assert.equal(result.providerMessageId, 'abc');
    assert.equal(call!.url, 'https://sms.test/api/sms/send');
    assert.deepEqual(call!.body, { api_key: 'key', to: '2348012345678', from: 'Jettys', sms: 'hello', type: 'plain', channel: 'generic' });
  });

  it('Resend authenticates with a bearer token and sends subject and text', async () => {
    let call: { headers: Record<string, string>; body: Record<string, any> } | undefined;
    const sender = new ResendSender({ apiKey: 're_key', from: 'Jetty <hi@jettyshair.com>' }, async (_url, init) => {
      call = { headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
      return json(200, { id: 'em_1' });
    });
    assert.equal((await sender.send({ to: 'ada@example.com', subject: 'Hi', text: 'Body' })).providerMessageId, 'em_1');
    assert.equal(call!.headers.authorization, 'Bearer re_key');
    assert.deepEqual(call!.body, { from: 'Jetty <hi@jettyshair.com>', to: ['ada@example.com'], subject: 'Hi', text: 'Body' });
  });

  it('classifies provider errors so the processor knows whether to retry', async () => {
    const make = (status: number) => new TermiiSender({ apiKey: 'k', senderId: 's', baseUrl: 'https://sms.test' }, async () => json(status, { message: 'nope' }));
    await assert.rejects(() => make(400).send({ to: '+2348012345678', text: 'x' }), PermanentSendError);
    await assert.rejects(() => make(500).send({ to: '+2348012345678', text: 'x' }), TransientSendError);
    await assert.rejects(() => make(429).send({ to: '+2348012345678', text: 'x' }), TransientSendError);
    const down = new TermiiSender({ apiKey: 'k', senderId: 's', baseUrl: 'https://sms.test' }, async () => {
      throw new Error('ECONNRESET');
    });
    await assert.rejects(() => down.send({ to: '+2348012345678', text: 'x' }), TransientSendError);
  });

  it('refuses the log provider in production, because it would print one-time codes', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://a@b/c', RATE_LIMIT_ENABLED: 'false' };
    assert.throws(() => createSenders(loadEnv(base), logger), /real providers in production/);
    const real = loadEnv({ ...base, SMS_PROVIDER: 'termii', TERMII_API_KEY: 'k', TERMII_SENDER_ID: 's', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'r', EMAIL_FROM: 'a@b.com' });
    const senders = createSenders(real, logger);
    assert.equal(senders.sms.name, 'termii');
    assert.equal(senders.email.name, 'resend');
  });

  it('requires credentials for a configured provider', () => {
    assert.throws(() => loadEnv({ SMS_PROVIDER: 'termii' }), /TERMII_API_KEY/);
    assert.throws(() => loadEnv({ EMAIL_PROVIDER: 'resend' }), /RESEND_API_KEY/);
  });
});
