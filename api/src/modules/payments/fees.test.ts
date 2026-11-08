import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimatePaymentFee } from './fees.js';

describe('estimatePaymentFee', () => {
  it('adds the flat fee and the percentage on a typical card order', () => {
    assert.equal(estimatePaymentFee(5_000_000, 'card'), 86_296); // ₦50,000 -> about ₦861
  });
  it('waives the flat fee under ₦2,500', () => assert.equal(estimatePaymentFee(100_000, 'card'), 1_524));
  it('caps the fee at ₦2,000', () => assert.equal(estimatePaymentFee(21_250_000, 'card'), 200_000));
  it('charges bank transfers the same local rate', () => assert.equal(estimatePaymentFee(5_000_000, 'bank_transfer'), 86_296));
  it('estimates nothing when no method is chosen', () => {
    assert.equal(estimatePaymentFee(5_000_000, undefined), 0);
  });
});
