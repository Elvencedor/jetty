import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PaystackProvider } from './paystack.js';
import { PaymentIndeterminateError } from './provider.js';

const input = { email: 'a@b.co', amountMinor: 5000, currency: 'NGN', reference: 'jh_ref', channels: ['card'], metadata: {} };
const ok = { status: true, data: { reference: 'jh_ref', access_code: 'ac_1', authorization_url: 'https://checkout.paystack.com/ac_1' } };

/** What Node's fetch throws when the name cannot be looked up: a TypeError whose cause carries the system error code. */
const lookupFailure = (code = 'ENOTFOUND') => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`getaddrinfo ${code} api.paystack.co`), { code }) });

function provider(steps: (Error | Response)[]) {
  let calls = 0;
  const fetchImpl = (async () => {
    const step = steps[calls++];
    if (!step) throw new Error('unexpected extra call');
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
  return { calls: () => calls, p: new PaystackProvider({ secretKey: 'sk_test_x', baseUrl: 'https://paystack.test', fetch: fetchImpl, retryDelayMs: 0 }) };
}

describe('PaystackProvider connection problems', () => {
  it('tries again when the name lookup fails, and succeeds once it does not', async () => {
    const { p, calls } = provider([lookupFailure(), lookupFailure('EAI_AGAIN'), new Response(JSON.stringify(ok))]);
    const result = await p.initialize(input);
    assert.equal(result.accessCode, 'ac_1');
    assert.equal(calls(), 3);
  });

  it('gives up after three tries and says why, so the log can name the cause', async () => {
    const { p, calls } = provider([lookupFailure(), lookupFailure(), lookupFailure()]);
    await assert.rejects(p.initialize(input), (err: Error) => err instanceof PaymentIndeterminateError && /ENOTFOUND/.test(err.message));
    assert.equal(calls(), 3);
  });

  it('does not resend a request that may have reached Paystack', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const { p, calls } = provider([timeout]);
    await assert.rejects(p.initialize(input), PaymentIndeterminateError);
    assert.equal(calls(), 1);
  });

  it('does not retry an error that is not a connection failure', async () => {
    const { p, calls } = provider([Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) })]);
    await assert.rejects(p.initialize(input), PaymentIndeterminateError);
    assert.equal(calls(), 1);
  });

  it('retries a verify the same way', async () => {
    const found = { status: true, data: { reference: 'jh_ref', status: 'success', amount: 5000, currency: 'NGN', id: 1, paid_at: null } };
    const { p, calls } = provider([lookupFailure(), new Response(JSON.stringify(found))]);
    const v = await p.verify('jh_ref');
    assert.equal(v.found, true);
    assert.equal(calls(), 2);
  });
});
