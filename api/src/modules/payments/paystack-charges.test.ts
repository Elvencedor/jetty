import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PaystackProvider } from './paystack.js';
import { PaymentIndeterminateError, PaymentRejectedError } from './provider.js';
import { listBanks, resetBankCache, withProvider } from './payouts.js';

type Seen = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };

function paystack(replies: ({ status?: number; body?: unknown } | Error)[]) {
  const seen: Seen[] = [];
  const queue = [...replies];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method ?? 'GET'), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    const next = queue.shift() ?? { body: {} };
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? 'not json' : JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  return { seen, provider: new PaystackProvider({ secretKey: 'sk_test_abcdef', baseUrl: 'https://paystack.test', fetch: fetchImpl }) };
}

const initInput = { email: 'a@b.com', amountMinor: 1_250_000, currency: 'NGN', reference: 'jh_ref', channels: ['card'], metadata: { orderId: 'o1' } };
const initOk = { status: true, data: { reference: 'jh_ref', access_code: 'ac', authorization_url: 'https://checkout.paystack.test/ac' } };

describe('PaystackProvider.initialize', () => {
  it('posts the amount in minor units with the bearer key and returns the checkout link', async () => {
    const { provider, seen } = paystack([{ body: initOk }]);
    const result = await provider.initialize({ ...initInput, callbackUrl: 'https://shop.test/done' });
    assert.deepEqual(result, { reference: 'jh_ref', accessCode: 'ac', authorizationUrl: 'https://checkout.paystack.test/ac' });
    assert.equal(seen[0]!.url, 'https://paystack.test/transaction/initialize');
    assert.equal(seen[0]!.method, 'POST');
    assert.equal(seen[0]!.headers.Authorization, 'Bearer sk_test_abcdef');
    assert.deepEqual(seen[0]!.body, { email: 'a@b.com', amount: 1_250_000, currency: 'NGN', reference: 'jh_ref', channels: ['card'], metadata: { orderId: 'o1' }, callback_url: 'https://shop.test/done' });
  });

  it('omits the callback and split fields unless given', async () => {
    const { provider, seen } = paystack([{ body: initOk }]);
    await provider.initialize(initInput);
    assert.equal('callback_url' in seen[0]!.body!, false);
    assert.equal('subaccount' in seen[0]!.body!, false);
  });

  it('defaults the fee bearer to the subaccount when splitting', async () => {
    const { provider, seen } = paystack([{ body: initOk }, { body: initOk }]);
    await provider.initialize({ ...initInput, subaccount: 'ACCT_1' });
    await provider.initialize({ ...initInput, subaccount: 'ACCT_1', bearer: 'account' });
    assert.equal(seen[0]!.body!.bearer, 'subaccount');
    assert.equal(seen[1]!.body!.bearer, 'account');
  });

  it('treats a definite refusal as rejected', async () => {
    const { provider } = paystack([{ status: 400, body: { status: false, message: 'Duplicate Transaction Reference' } }]);
    await assert.rejects(provider.initialize(initInput), PaymentRejectedError);
  });

  it('treats timeouts, 5xx and 429 as an unknown outcome', async () => {
    for (const reply of [new Error('timeout'), { status: 500 }, { status: 503 }, { status: 429 }] as const) {
      const { provider } = paystack([reply]);
      await assert.rejects(provider.initialize(initInput), PaymentIndeterminateError);
    }
  });

  it('treats a 200 with an unusable body as an unknown outcome', async () => {
    for (const body of [{ status: true, data: {} }, { status: false }, undefined, { status: true, data: { reference: 'r', access_code: 'a' } }]) {
      const { provider } = paystack([{ body }]);
      await assert.rejects(provider.initialize(initInput), PaymentIndeterminateError);
    }
  });
});

describe('PaystackProvider.verify', () => {
  const ok = (over: Record<string, unknown> = {}) => ({ body: { status: true, data: { reference: 'r1', status: 'success', amount: 500000, currency: 'NGN', id: 99, paid_at: '2026-06-01T10:00:00.000Z', ...over } } });

  it('returns the transaction with the id as a string and the paid time as a date', async () => {
    const { provider, seen } = paystack([ok()]);
    const tx = await provider.verify('r 1/x');
    assert.deepEqual(tx, { found: true, reference: 'r1', status: 'success', amountMinor: 500000, currency: 'NGN', transactionId: '99', paidAt: new Date('2026-06-01T10:00:00.000Z') });
    assert.equal(seen[0]!.url, 'https://paystack.test/transaction/verify/r%201%2Fx');
  });

  it('reports the requested amount, not the amount with the fee the customer paid on top', async () => {
    const { provider } = paystack([ok({ amount: 21450000, requested_amount: 21250000, fees: 200000 })]);
    const tx = await provider.verify('r1');
    assert.equal(tx.found && tx.amountMinor, 21250000);
  });

  it('reports paidAt as null when unpaid', async () => {
    const { provider } = paystack([ok({ status: 'abandoned', paid_at: null })]);
    const tx = await provider.verify('r1');
    assert.equal(tx.found && tx.paidAt, null);
    assert.equal(tx.found && tx.status, 'abandoned');
  });

  it('reports an unknown reference as not found', async () => {
    const { provider } = paystack([{ status: 404, body: { status: false } }]);
    assert.deepEqual(await provider.verify('nope'), { found: false });
  });

  it('is indeterminate on server trouble, network failure or a malformed body', async () => {
    for (const reply of [{ status: 500 }, { status: 401, body: {} }, new Error('down'), ok({ amount: 12.5 }), ok({ currency: undefined }), ok({ id: undefined }), ok({ reference: '' }), { body: { status: false } }] as const) {
      const { provider } = paystack([reply]);
      await assert.rejects(provider.verify('r1'), PaymentIndeterminateError);
    }
  });
});

describe('PaystackProvider.refund', () => {
  const input = { reference: 'jh_ref', amountMinor: 250000, currency: 'NGN' };

  it('posts the charge reference and amount and keeps the refund id as the reference', async () => {
    const { provider, seen } = paystack([{ body: { status: true, data: { id: 777, status: 'pending' } } }]);
    const result = await provider.refund({ ...input, customerNote: 'Sorry', merchantNote: 'order cancelled' });
    assert.deepEqual(result, { providerReference: '777', status: 'pending' });
    assert.deepEqual(seen[0]!.body, { transaction: 'jh_ref', amount: 250000, currency: 'NGN', customer_note: 'Sorry', merchant_note: 'order cancelled' });
    assert.equal(seen[0]!.url, 'https://paystack.test/refund');
  });

  it('leaves out notes that were not given', async () => {
    const { provider, seen } = paystack([{ body: { status: true, data: { id: 1, status: 'processed' } } }]);
    await provider.refund(input);
    assert.deepEqual(Object.keys(seen[0]!.body!).sort(), ['amount', 'currency', 'transaction']);
  });

  it('rejects with Paystack\'s reason, truncated', async () => {
    const { provider } = paystack([{ status: 400, body: { status: false, message: 'x'.repeat(500) } }]);
    await assert.rejects(provider.refund(input), (e: PaymentRejectedError) => e instanceof PaymentRejectedError && e.message.length < 300);
  });

  it('is indeterminate when the outcome is unknown', async () => {
    for (const reply of [new Error('timeout'), { status: 502 }, { status: 429 }, { body: { status: true, data: {} } }, { body: { status: false } }] as const) {
      const { provider } = paystack([reply]);
      await assert.rejects(provider.refund(input), PaymentIndeterminateError);
    }
  });
});

describe('withProvider and the bank cache', () => {
  it('passes results through', async () => {
    assert.equal(await withProvider(async () => 5), 5);
  });
  it('turns a rejection into an actionable 422 with the provider\'s detail', async () => {
    await assert.rejects(withProvider(async () => { throw new PaymentRejectedError('no', 'Could not resolve account name'); }), (e: { output: { statusCode: number }; message: string; data: { code: string } }) => e.output.statusCode === 422 && e.data.code === 'PAYOUT_REJECTED' && /resolve/.test(e.message));
  });
  it('lets the caller choose the rejection error', async () => {
    await assert.rejects(withProvider(async () => { throw new PaymentRejectedError('no'); }, () => new Error('custom')), /custom/);
  });
  it('turns an unknown outcome into a retryable 503', async () => {
    await assert.rejects(withProvider(async () => { throw new PaymentIndeterminateError('x'); }), (e: { output: { statusCode: number }; data: { code: string } }) => e.output.statusCode === 503 && e.data.code === 'PAYSTACK_UNAVAILABLE');
  });
  it('rethrows unrelated errors untouched', async () => {
    await assert.rejects(withProvider(async () => { throw new TypeError('bug'); }), TypeError);
  });

  it('caches the bank list for a day', async () => {
    resetBankCache();
    let calls = 0;
    const provider = { listBanks: async () => { calls++; return [{ name: 'A', code: '1' }]; } } as never;
    const t0 = 1_000_000;
    await listBanks(provider, t0);
    await listBanks(provider, t0 + 23 * 3600_000);
    assert.equal(calls, 1);
    await listBanks(provider, t0 + 25 * 3600_000);
    assert.equal(calls, 2);
    resetBankCache();
    await listBanks(provider, t0 + 25 * 3600_000);
    assert.equal(calls, 3);
  });
});
