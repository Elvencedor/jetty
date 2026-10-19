import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { adminSessions, adminUsers, analyticsEvents, customerSessions, customers, notificationOutbox } from '../db/schema/index.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../testing/database.js';
import { cleanupAnalyticsEvents, cleanupOutbox, cleanupSessions } from './retention.js';

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day);

describe('retention', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t?.destroy();
  });

  it('removes long-dead sessions of both kinds but keeps live, recently ended and recently revoked ones', async () => {
    const [c] = await t.db.insert(customers).values({ phoneE164: '+2348011110000', status: 'active' }).returning();
    const [a] = await t.db.insert(adminUsers).values({ email: 'retention@example.com', passwordHash: 'x' }).returning();
    const rows = (hash: string, expiresAt: Date, revokedAt: Date | null) => ({ refreshTokenHash: hash, expiresAt, revokedAt });
    await t.db.insert(customerSessions).values([
      { customerId: c!.id, ...rows('c-live', ago(-30), null) },
      { customerId: c!.id, ...rows('c-expired-old', ago(20), null) },
      { customerId: c!.id, ...rows('c-expired-recent', ago(2), null) },
      { customerId: c!.id, ...rows('c-revoked-old', ago(-5), ago(10)) },
      { customerId: c!.id, ...rows('c-revoked-recent', ago(-5), ago(1)) },
    ]);
    await t.db.insert(adminSessions).values([
      { adminUserId: a!.id, ...rows('a-live', ago(-1), null) },
      { adminUserId: a!.id, ...rows('a-expired-old', ago(9), null) },
      { adminUserId: a!.id, ...rows('a-revoked-old', ago(-1), ago(8)) },
    ]);
    assert.equal(await cleanupSessions(t.db), 4);
    assert.deepEqual((await t.db.select().from(customerSessions)).map((s) => s.refreshTokenHash).sort(), ['c-expired-recent', 'c-live', 'c-revoked-recent']);
    assert.deepEqual((await t.db.select().from(adminSessions)).map((s) => s.refreshTokenHash), ['a-live']);
    assert.equal(await cleanupSessions(t.db), 0, 'idempotent');
  });

  it('drops delivered and long-failed messages but never pending or still-retrying ones', async () => {
    const row = (status: string, over: Partial<typeof notificationOutbox.$inferInsert>) => ({ eventType: 'order.placed', recipient: '+234', channel: 'sms', payload: { tag: status }, status, ...over });
    await t.db.insert(notificationOutbox).values([
      row('sent', { payload: { tag: 'sent-old' }, sentAt: ago(20) }),
      row('sent', { payload: { tag: 'sent-recent' }, sentAt: ago(2) }),
      row('failed', { payload: { tag: 'failed-old' }, createdAt: ago(40) }),
      row('failed', { payload: { tag: 'failed-recent' }, createdAt: ago(3) }),
      row('pending', { payload: { tag: 'pending-old' }, createdAt: ago(60) }),
      row('sending', { payload: { tag: 'sending-old' }, createdAt: ago(60) }),
    ]);
    assert.equal(await cleanupOutbox(t.db), 2);
    const left = (await t.db.select().from(notificationOutbox)).map((m) => (m.payload as { tag: string }).tag).sort();
    assert.deepEqual(left, ['failed-recent', 'pending-old', 'sending-old', 'sent-recent']);
  });

  it('trims analytics events past the retention window', async () => {
    await t.db.insert(analyticsEvents).values([
      { eventName: 'product_view', occurredAt: ago(120) },
      { eventName: 'product_view', occurredAt: ago(89) },
      { eventName: 'product_view', occurredAt: ago(1) },
    ]);
    assert.equal(await cleanupAnalyticsEvents(t.db), 1);
    assert.equal((await t.db.select().from(analyticsEvents)).length, 2);
  });
});
