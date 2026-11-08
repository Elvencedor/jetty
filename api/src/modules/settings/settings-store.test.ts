import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { adminUsers, storeSettings } from '../../db/schema/index.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../testing/database.js';
import { SETTINGS, getSetting, publicSettings, updateSetting } from './settings.js';

type Policies = { returnWindowDays: number; podMaxOrderMinor: number | null };
type Payments = { enabledMethods: string[]; cardHoldMinutes: number; transferHoldMinutes: number };

describe('settings store', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let adminId: string;

  before(async () => {
    t = await createTestDatabase();
    const [admin] = await t.db.insert(adminUsers).values({ email: 'owner@example.com', passwordHash: 'x' }).returning();
    adminId = admin!.id;
  });
  after(async () => {
    await t?.destroy();
  });

  it('returns the defaults when nothing is stored', async () => {
    assert.deepEqual(await getSetting(t.db, 'policies'), SETTINGS.policies.defaults);
  });

  it('layers a stored partial value over the defaults', async () => {
    await t.db.insert(storeSettings).values({ key: 'app.store', value: { name: 'Custom' } });
    const store = await getSetting(t.db, 'store');
    assert.equal(store.name, 'Custom');
    assert.equal(store.contactEmail, '');
  });

  it('update merges a patch, reports before and after, and records who changed it', async () => {
    const { before, after } = (await updateSetting(t.db, adminId, 'policies', { returnWindowDays: 14 })) as { before: Policies; after: Policies };
    assert.equal(before.returnWindowDays, 7);
    assert.equal(after.returnWindowDays, 14);
    assert.equal(after.podMaxOrderMinor, null);
    const [row] = await t.db.select().from(storeSettings).where(eq(storeSettings.key, 'app.policies'));
    assert.equal(row!.updatedByAdminId, adminId);
    assert.deepEqual(await getSetting(t.db, 'policies'), after);
  });

  it('successive updates build on each other', async () => {
    await updateSetting(t.db, adminId, 'payments', { cardHoldMinutes: 20 });
    const { before, after } = (await updateSetting(t.db, adminId, 'payments', { transferHoldMinutes: 60 })) as { before: Payments; after: Payments };
    assert.equal(before.cardHoldMinutes, 20);
    assert.deepEqual([after.cardHoldMinutes, after.transferHoldMinutes], [20, 60]);
  });

  it('a pay-on-delivery limit can be set and then switched off again with null', async () => {
    await updateSetting(t.db, adminId, 'policies', { podMaxOrderMinor: 5_000_000 });
    assert.equal((await getSetting(t.db, 'policies')).podMaxOrderMinor, 5_000_000);
    await updateSetting(t.db, adminId, 'policies', { podMaxOrderMinor: null });
    assert.equal((await getSetting(t.db, 'policies')).podMaxOrderMinor, null);
  });

  it('concurrent updates to different fields do not lose each other', async () => {
    await Promise.all(Array.from({ length: 6 }, (_, i) => updateSetting(t.db, adminId, 'store', { [['contactEmail', 'contactPhone', 'whatsappNumber', 'showroomAddress', 'showroomHours', 'name'][i]!]: `v${i}` })));
    const store = await getSetting(t.db, 'store');
    assert.deepEqual([store.contactEmail, store.contactPhone, store.whatsappNumber, store.showroomAddress, store.showroomHours, store.name], ['v0', 'v1', 'v2', 'v3', 'v4', 'v5']);
  });

  it('publicSettings exposes every public group with defaults filled in', async () => {
    const all = await publicSettings(t.db);
    assert.deepEqual(Object.keys(all).sort(), ['payments', 'policies', 'store']);
    assert.equal((all.payments as Payments).enabledMethods.length, 2);
  });
});
