import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { verifyPaystackSignature } from './signature.js';

const SECRET = 'sk_test_webhook_secret';
const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'r1' } }));
const sign = (raw: Buffer, secret = SECRET) => createHmac('sha512', secret).update(raw).digest('hex');

describe('verifyPaystackSignature', () => {
  it('accepts the HMAC-SHA512 of the exact bytes', () => {
    assert.equal(verifyPaystackSignature(body, sign(body), SECRET), true);
  });
  it('accepts an upper-case hex signature', () => {
    assert.equal(verifyPaystackSignature(body, sign(body).toUpperCase(), SECRET), true);
  });
  it('rejects a missing or empty signature', () => {
    assert.equal(verifyPaystackSignature(body, undefined, SECRET), false);
    assert.equal(verifyPaystackSignature(body, '', SECRET), false);
  });
  it('rejects a signature from another secret', () => {
    assert.equal(verifyPaystackSignature(body, sign(body, 'other'), SECRET), false);
  });
  it('rejects a body altered by even one byte, such as re-serialised JSON', () => {
    const pretty = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));
    assert.equal(verifyPaystackSignature(pretty, sign(body), SECRET), false);
  });
  it('rejects non-hex, truncated and over-long signatures without throwing', () => {
    assert.equal(verifyPaystackSignature(body, 'zzzz', SECRET), false);
    assert.equal(verifyPaystackSignature(body, sign(body).slice(0, 64), SECRET), false);
    assert.equal(verifyPaystackSignature(body, `${sign(body)}00`, SECRET), false);
  });
});
