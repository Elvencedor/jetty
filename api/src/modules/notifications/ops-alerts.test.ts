import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { notificationOutbox } from '../../db/schema/index.js';
import { createLogger } from '../../lib/logger.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { processOutbox } from './process.js';
import { render } from './templates.js';
import { TransientSendError, type Message, type Sender, type Senders } from './senders.js';

class FakeSender implements Sender {
  readonly name = 'fake';
  sent: Message[] = [];
  failWith: Error | null = null;
  async send(message: Message) {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    return {};
  }
}

describe('operations alerts and order messages', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  const sms = new FakeSender();
  const email = new FakeSender();
  const senders: Senders = { sms, email };
  const alert = async () =>
    (await t.db.insert(notificationOutbox).values({ eventType: 'payment.exception', recipient: 'operations', channel: 'internal', payload: { orderId: 'o1', orderNumber: 'JH-9', reason: 'DUPLICATE_CHARGE' }, nextAttemptAt: new Date(Date.now() - 1000) }).returning())[0]!;

  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t?.destroy();
  });

  it('emails the operations address when one is configured, and only logs otherwise', async () => {
    const quiet = await alert();
    await processOutbox(t.db, senders, createLogger('error'), new Date());
    assert.equal(email.sent.length, 0);
    assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.id, quiet.id)))[0]!.status, 'sent');

    const loud = await alert();
    await processOutbox(t.db, senders, createLogger('error'), new Date(), { opsEmail: 'ops@example.com' });
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0]!.to, 'ops@example.com');
    assert.match(email.sent[0]!.subject!, /DUPLICATE_CHARGE.*JH-9/);
    assert.equal((await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.id, loud.id)))[0]!.status, 'sent');
  });

  it('retries the alert when email is down instead of dropping it', async () => {
    const row = await alert();
    email.failWith = new TransientSendError('provider 503');
    const result = await processOutbox(t.db, senders, createLogger('error'), new Date(), { opsEmail: 'ops@example.com' });
    assert.equal(result.retried, 1);
    const after = (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.id, row.id)))[0]!;
    assert.deepEqual([after.status, after.lastError], ['pending', 'provider 503']);
    email.failWith = null;
  });

  it('renders fulfilment and refund messages for both channels, with pickup wording', () => {
    const payload = { orderNumber: 'JH-1', deliveryMethod: 'next_day' };
    assert.match(render('order.packed', 'sms', '+234', payload)!.text, /packed and will be on its way/);
    assert.match(render('order.out_for_delivery', 'email', 'a@b.co', payload)!.subject!, /out for delivery/);
    assert.match(render('order.delivered', 'sms', '+234', payload)!.text, /delivered/);
    assert.match(render('order.packed', 'sms', '+234', { ...payload, deliveryMethod: 'pickup' })!.text, /ready for you to collect/);
    assert.match(render('order.delivered', 'sms', '+234', { ...payload, deliveryMethod: 'pickup' })!.text, /collected/);
    assert.match(render('order.refunded', 'sms', '+234', { orderNumber: 'JH-1', amount: '2,500.00' })!.text, /₦2,500\.00/);
    assert.equal(render('order.refunded', 'sms', '+234', { orderNumber: 'JH-1' }), null, 'no amount, no message');
  });
});
