import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PaystackProvider } from './paystack.js';
import { PaymentIndeterminateError, PaymentRejectedError } from './provider.js';

type Seen = { url: string; method: string; body: Record<string, unknown> | null };

/** A Paystack that answers each call from a queue and remembers what it was asked. */
function paystack(replies: { status?: number; body: unknown }[], key = 'sk_test_secret') {
  const seen: Seen[] = [];
  const queue = [...replies];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null });
    const next = queue.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  return { seen, provider: new PaystackProvider({ secretKey: key, baseUrl: 'https://paystack.test', fetch: fetchImpl }) };
}

describe('PaystackProvider payouts', () => {
  it('knows test keys from live ones', () => {
    assert.equal(paystack([]).provider.mode, 'test');
    assert.equal(paystack([], 'sk_live_abc12345').provider.mode, 'live');
  });

  it('splits a sale to the subaccount only when one is given', async () => {
    const ok = { body: { status: true, data: { reference: 'r', access_code: 'a', authorization_url: 'https://c/x' } } };
    const base = { email: 'a@b.co', amountMinor: 5000, currency: 'NGN', reference: 'r', channels: ['card'], metadata: {} };
    const split = paystack([ok]);
    await split.provider.initialize({ ...base, subaccount: 'ACCT_1', bearer: 'subaccount' });
    assert.deepEqual([split.seen[0]!.body!.subaccount, split.seen[0]!.body!.bearer], ['ACCT_1', 'subaccount']);
    const plain = paystack([ok]);
    await plain.provider.initialize(base);
    assert.ok(!('subaccount' in plain.seen[0]!.body!) && !('bearer' in plain.seen[0]!.body!));
  });

  it('lists active banks across pages, once each, by name', async () => {
    const { provider, seen } = paystack([
      { body: { status: true, data: [{ name: 'Zenith Bank', code: '057' }, { name: 'Old Bank', code: '001', is_deleted: true }], meta: { next: 'abc' } } },
      { body: { status: true, data: [{ name: 'Access Bank', code: '044' }, { name: 'Zenith Bank', code: '057' }, { name: 'Dormant', code: '002', active: false }], meta: { next: null } } },
    ]);
    assert.deepEqual(await provider.listBanks(), [{ name: 'Access Bank', code: '044' }, { name: 'Zenith Bank', code: '057' }]);
    assert.match(seen[1]!.url, /next=abc/);
  });

  it('resolves an account name, and passes on Paystack\'s reason when there is no such account', async () => {
    const ok = paystack([{ body: { status: true, data: { account_name: 'ADA OKAFOR', account_number: '0123456789' } } }]);
    assert.deepEqual(await ok.provider.resolveAccount({ bankCode: '058', accountNumber: '0123456789' }), { accountName: 'ADA OKAFOR', accountNumber: '0123456789' });
    assert.match(ok.seen[0]!.url, /bank\/resolve\?account_number=0123456789&bank_code=058/);
    const no = paystack([{ status: 422, body: { status: false, message: 'Could not resolve account name' } }]);
    await assert.rejects(no.provider.resolveAccount({ bankCode: '058', accountNumber: '0000000000' }), (e: unknown) => e instanceof PaymentRejectedError && e.detail === 'Could not resolve account name');
  });

  it('creates a subaccount, or updates the one it is given', async () => {
    const input = { businessName: "Jetty's Hair", bankCode: '058', accountNumber: '0123456789', percentageCharge: 0 };
    const created = paystack([{ status: 201, body: { status: true, data: { subaccount_code: 'ACCT_new' } } }]);
    assert.deepEqual(await created.provider.saveSubaccount(input), { subaccountCode: 'ACCT_new' });
    assert.deepEqual([created.seen[0]!.method, created.seen[0]!.url], ['POST', 'https://paystack.test/subaccount']);
    assert.deepEqual(created.seen[0]!.body, { business_name: "Jetty's Hair", settlement_bank: '058', account_number: '0123456789', percentage_charge: 0 });
    const updated = paystack([{ body: { status: true, data: { subaccount_code: 'ACCT_old' } } }]);
    assert.deepEqual(await updated.provider.saveSubaccount(input, 'ACCT_old'), { subaccountCode: 'ACCT_old' });
    assert.deepEqual([updated.seen[0]!.method, updated.seen[0]!.url], ['PUT', 'https://paystack.test/subaccount/ACCT_old']);
  });

  it('treats server trouble as an unknown outcome', async () => {
    await assert.rejects(paystack([{ status: 503, body: {} }]).provider.listBanks(), PaymentIndeterminateError);
    await assert.rejects(paystack([{ body: { status: true, data: {} } }]).provider.saveSubaccount({ businessName: 'X Ltd', bankCode: '058', accountNumber: '0123456789', percentageCharge: 0 }), PaymentIndeterminateError);
  });
});
