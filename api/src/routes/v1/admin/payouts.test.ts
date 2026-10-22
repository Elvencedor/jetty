import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { adminAuditLog, deliveryZones, inventory, productVariants, products } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { resetBankCache } from '../../../modules/payments/payouts.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';
import { FakeProvider } from '../../../testing/fake-provider.js';

type Json = Record<string, any>;

describe('payout account (Paystack subaccount)', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const provider = new FakeProvider();
  let owner: Awaited<ReturnType<typeof signInAdmin>>;
  let manager: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;
  let variantId = '';

  const call = async (method: string, url: string, payload?: Json, who = owner) => {
    const res = await api.inject({ method: method as 'GET', url: `/api/v1${url}`, ...(payload ? { payload } : {}), headers: who.headers });
    return { status: res.statusCode, body: res.result as Json };
  };
  const connect = (over: Json = {}) => call('PUT', '/admin/payouts/account', { businessName: "Jetty's Hair", bankCode: '058', accountNumber: '0123456789', ...over });

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, payments: provider });
    await api.initialize();
    owner = await signInAdmin(t.db, api, 'owner');
    manager = await signInAdmin(t.db, api, 'manager');
    support = await signInAdmin(t.db, api, 'support');
    const [p] = await t.db.insert(products).values({ slug: 'payout-wig', title: 'Payout Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [v] = await t.db.insert(productVariants).values({ productId: p!.id, sku: 'PAY-1', optionSignature: {}, priceMinor: 100000 }).returning();
    await t.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: 100 });
    variantId = v!.id;
    await t.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
  });
  beforeEach(() => {
    provider.reset();
    resetBankCache();
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  const checkoutCard = async (key: string) =>
    api.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: { items: [{ variantId, quantity: 1 }], promotionCodes: [], contact: { phone: '+2348455000001' }, deliveryAddress: { recipientName: 'Ada', addressLine1: '1 Street', city: 'Lagos', state: 'Lagos', countryCode: 'NG' }, deliveryMethod: 'next_day', paymentMethod: 'card', termsAccepted: true },
      headers: { 'idempotency-key': `${key}-abcdefgh-0123456789abcdefghijklmnopqrstuvwxyz` },
    });

  it('is for owners to change and managers to read; support has no business here', async () => {
    assert.equal((await call('GET', '/admin/payouts/account', undefined, manager)).status, 200);
    assert.equal((await call('GET', '/admin/payouts/account', undefined, support)).status, 403);
    assert.equal((await call('GET', '/admin/payouts/banks', undefined, manager)).status, 403);
    assert.equal((await call('PUT', '/admin/payouts/account', { businessName: 'X Ltd', bankCode: '058', accountNumber: '0123456789' }, manager)).status, 403);
    assert.equal((await call('POST', '/admin/payouts/resolve', { bankCode: '058', accountNumber: '0123456789' }, manager)).status, 403);
  });

  it('starts unconnected, lists banks, and looks up who owns an account', async () => {
    const start = await call('GET', '/admin/payouts/account');
    assert.deepEqual(start.body, { configured: false, mode: 'test' });
    const banks = await call('GET', '/admin/payouts/banks');
    assert.deepEqual(banks.body.data.map((b: Json) => b.code), ['044', '058', '057']);
    const ok = await call('POST', '/admin/payouts/resolve', { bankCode: '058', accountNumber: '0123456789' });
    assert.deepEqual(ok.body, { accountName: 'JETTY HAIR LTD' });
    const missing = await call('POST', '/admin/payouts/resolve', { bankCode: '058', accountNumber: '0999999999' });
    assert.equal(missing.status, 422);
    assert.equal(missing.body.error.code, 'ACCOUNT_NOT_FOUND');
    assert.equal((await call('POST', '/admin/payouts/resolve', { bankCode: '058', accountNumber: '123' })).status, 422);
  });

  it('connects the account, keeping only the last four digits, and changes it later under the same subaccount', async () => {
    const first = await connect();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual([first.body.configured, first.body.bankName, first.body.accountName, first.body.accountLast4], [true, 'GTBank', 'JETTY HAIR LTD', '6789']);
    assert.ok(!JSON.stringify(first.body).includes('0123456789'), 'the full number is never returned');
    const code = first.body.subaccountCode;
    assert.equal(provider.subaccounts.at(-1)!.input.accountNumber, '0123456789');

    provider.accounts.set('0222222222', 'JETTY HAIR TWO');
    const again = await connect({ bankCode: '044', accountNumber: '0222222222' });
    assert.equal(again.status, 200);
    assert.equal(again.body.subaccountCode, code, 'the same Paystack subaccount is updated, not a new one created');
    assert.deepEqual([again.body.bankName, again.body.accountLast4], ['Access Bank', '2222']);
    assert.equal((await call('GET', '/admin/payouts/account')).body.accountName, 'JETTY HAIR TWO');

    const audit = (await t.db.select().from(adminAuditLog)).filter((a) => a.action === 'settings.payout_account');
    assert.equal(audit.length >= 2, true);
    assert.ok(!JSON.stringify(audit).includes('0123456789') && !JSON.stringify(audit).includes('0222222222'), 'the audit log holds no full account numbers');
  });

  it('refuses an unknown bank or account, and reports Paystack refusing or being down without saving anything', async () => {
    await connect();
    const before = (await call('GET', '/admin/payouts/account')).body;
    assert.equal((await connect({ bankCode: '999' })).body.error.code, 'UNKNOWN_BANK');
    assert.equal((await connect({ accountNumber: '0999999999' })).body.error.code, 'ACCOUNT_NOT_FOUND');
    assert.equal((await connect({ businessName: 'x' })).status, 422);

    provider.accounts.set('0333333333', 'SOMEONE');
    provider.subaccountMode = 'reject';
    const refused = await connect({ accountNumber: '0333333333' });
    assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.message], [422, 'PAYOUT_REJECTED', 'Settlement bank is invalid']);
    provider.subaccountMode = 'timeout';
    assert.equal((await connect({ accountNumber: '0333333333' })).status, 503);
    assert.deepEqual((await call('GET', '/admin/payouts/account')).body, before, 'nothing changed');
  });

  it('sends new sales to the connected subaccount, and to the main account before one exists', async () => {
    const fresh = await createTestDatabase();
    const bare = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: fresh, payments: provider });
    await bare.initialize();
    // This server has no payout account yet.
    const [p] = await fresh.db.insert(products).values({ slug: 'plain-wig', title: 'Plain Wig', status: 'active', publishedAt: new Date('2026-01-01') }).returning();
    const [v] = await fresh.db.insert(productVariants).values({ productId: p!.id, sku: 'PL-1', optionSignature: {}, priceMinor: 100000 }).returning();
    await fresh.db.insert(inventory).values({ variantId: v!.id, onHandQuantity: 5 });
    await fresh.db.insert(deliveryZones).values({ name: 'Lagos', state: 'Lagos', nextDayFeeMinor: 150000 });
    const place = (key: string) => bare.inject({ method: 'POST', url: '/api/v1/checkout', payload: { items: [{ variantId: v!.id, quantity: 1 }], promotionCodes: [], contact: { phone: '+2348455000002' }, deliveryAddress: { recipientName: 'Ada', addressLine1: '1 Street', city: 'Lagos', state: 'Lagos', countryCode: 'NG' }, deliveryMethod: 'next_day', paymentMethod: 'card', termsAccepted: true }, headers: { 'idempotency-key': `${key}-abcdefgh-0123456789abcdefghijklmnopqrstuvwxyz` } });
    assert.equal((await place('plain-1')).statusCode, 201);
    assert.equal(provider.calls.at(-1)!.subaccount, undefined);
    await bare.stop();
    await fresh.destroy();

    provider.reset();
    const code = (await connect()).body.subaccountCode;
    const res = await checkoutCard('with-sub-1');
    assert.equal(res.statusCode, 201, JSON.stringify(res.result));
    assert.deepEqual([provider.calls.at(-1)!.subaccount, provider.calls.at(-1)!.bearer], [code, 'subaccount']);
  });
});
