import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashRequest } from './idempotency.js';

describe('hashRequest', () => {
  it('is a sha256 hex digest', () => {
    assert.match(hashRequest({ a: 1 }), /^[0-9a-f]{64}$/);
  });
  it('ignores object key order, at any depth', () => {
    assert.equal(hashRequest({ a: 1, b: { c: 2, d: 3 } }), hashRequest({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it('treats undefined properties as absent', () => {
    assert.equal(hashRequest({ a: 1, b: undefined }), hashRequest({ a: 1 }));
  });
  it('is sensitive to values, types and array order', () => {
    assert.notEqual(hashRequest({ a: 1 }), hashRequest({ a: 2 }));
    assert.notEqual(hashRequest({ a: 1 }), hashRequest({ a: '1' }));
    assert.notEqual(hashRequest({ a: [1, 2] }), hashRequest({ a: [2, 1] }));
    assert.notEqual(hashRequest({ a: null }), hashRequest({}));
  });
  it('handles scalars and arrays at the top level', () => {
    assert.notEqual(hashRequest([]), hashRequest({}));
    assert.equal(hashRequest('x'), hashRequest('x'));
    assert.equal(hashRequest([{ b: 1, a: 2 }]), hashRequest([{ a: 2, b: 1 }]));
  });
});
