import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocate } from './allocate.js';
import { mergeItems } from './cart.js';
import { normaliseCode } from './load-promotions.js';
import { CONFIG_SCHEMAS, SCOPE_SCHEMA } from './promotions.js';
import { paymentEmail } from '../checkout/contact.js';
import { estimateFor } from '../delivery/zones.js';

describe('mergeItems', () => {
  it('sums quantities of duplicate variants and keeps first-seen order', () => {
    assert.deepEqual(mergeItems([{ variantId: 'a', quantity: 1 }, { variantId: 'b', quantity: 2 }, { variantId: 'a', quantity: 3 }]), [{ variantId: 'a', quantity: 4 }, { variantId: 'b', quantity: 2 }]);
  });
  it('handles an empty cart', () => {
    assert.deepEqual(mergeItems([]), []);
  });
});

describe('normaliseCode', () => {
  it('trims and upper-cases so codes are case-insensitive', () => {
    assert.equal(normaliseCode('  save10 '), 'SAVE10');
    assert.equal(normaliseCode('Save-10'), 'SAVE-10');
  });
});

describe('allocate (extra edge cases)', () => {
  it('splits proportionally', () => {
    assert.deepEqual(allocate(100, [75, 25]), [75, 25]);
    assert.deepEqual(allocate(10, [1, 3]), [3, 7]);
  });
  it('gives leftover units to the largest remainders, ties to the lowest index', () => {
    assert.deepEqual(allocate(1, [1, 1, 1]), [1, 0, 0]);
    assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  });
  it('gives nothing to zero-weight lines', () => {
    assert.deepEqual(allocate(10, [0, 5, 0, 5]), [0, 5, 0, 5]);
  });
  it('returns zeros for non-positive totals and for no lines', () => {
    assert.deepEqual(allocate(-5, [1, 2]), [0, 0]);
    assert.deepEqual(allocate(5, []), []);
  });
  it('always sums exactly to the total, for many shapes', () => {
    for (let total = 0; total < 60; total++) {
      for (const weights of [[1], [1, 2, 3], [7, 7, 7, 7], [100, 1], [5, 0, 9]]) {
        const parts = allocate(total, weights);
        assert.equal(parts.reduce((a, b) => a + b, 0), total, `${total} over ${weights}`);
      }
    }
  });
  it('never exceeds a line weight when the total fits within the sum', () => {
    const weights = [1000, 1, 999];
    for (const total of [1, 500, 1500, 2000]) {
      allocate(total, weights).forEach((p, i) => assert.ok(p <= weights[i]!, `${total}`));
    }
  });
});

describe('promotion configuration schemas', () => {
  const ok = (kind: keyof typeof CONFIG_SCHEMAS, v: unknown) => CONFIG_SCHEMAS[kind].validate(v).error === undefined;
  const U = '11111111-1111-4111-8111-111111111111';

  it('percentage: 0 < percent <= 100 with an optional cap', () => {
    assert.equal(ok('percentage', { version: 1, percent: 10 }), true);
    assert.equal(ok('percentage', { version: 1, percent: 100 }), true);
    assert.equal(ok('percentage', { version: 1, percent: 12.5, maxDiscountMinor: 0 }), true);
    assert.equal(ok('percentage', { version: 1, percent: 0 }), false);
    assert.equal(ok('percentage', { version: 1, percent: 101 }), false);
    assert.equal(ok('percentage', { version: 1, percent: 10, maxDiscountMinor: -1 }), false);
    assert.equal(ok('percentage', { percent: 10 }), false);
    assert.equal(ok('percentage', { version: 2, percent: 10 }), false);
  });
  it('fixed_amount: a positive whole amount', () => {
    assert.equal(ok('fixed_amount', { version: 1, amountMinor: 1 }), true);
    assert.equal(ok('fixed_amount', { version: 1, amountMinor: 0 }), false);
    assert.equal(ok('fixed_amount', { version: 1, amountMinor: 10.5 }), false);
  });
  it('buy_x_get_y: positive whole buy/get, percentOff defaults to 100', () => {
    const { value, error } = CONFIG_SCHEMAS.buy_x_get_y.validate({ version: 1, buy: 2, get: 1 });
    assert.equal(error, undefined);
    assert.equal(value.percentOff, 100);
    assert.equal(ok('buy_x_get_y', { version: 1, buy: 0, get: 1 }), false);
    assert.equal(ok('buy_x_get_y', { version: 1, buy: 1, get: 1, percentOff: 0 }), false);
    assert.equal(ok('buy_x_get_y', { version: 1, buy: 1, get: 1, percentOff: 50 }), true);
  });
  it('free_delivery: optional list of zone ids', () => {
    assert.equal(ok('free_delivery', { version: 1 }), true);
    assert.equal(ok('free_delivery', { version: 1, zoneIds: [U] }), true);
    assert.equal(ok('free_delivery', { version: 1, zoneIds: ['x'] }), false);
  });
  it('free_gift: a variant and a quantity of 1-10 (default 1)', () => {
    assert.equal(CONFIG_SCHEMAS.free_gift.validate({ version: 1, variantId: U }).value.quantity, 1);
    assert.equal(ok('free_gift', { version: 1, variantId: U, quantity: 10 }), true);
    assert.equal(ok('free_gift', { version: 1, variantId: U, quantity: 11 }), false);
    assert.equal(ok('free_gift', { version: 1, quantity: 1 }), false);
  });
  it('scope: include by product/collection and exclude products; unknown keys are rejected', () => {
    assert.equal(SCOPE_SCHEMA.validate({}).error, undefined);
    assert.equal(SCOPE_SCHEMA.validate({ include: { allProducts: true }, excludeProductIds: [U] }).error, undefined);
    assert.equal(SCOPE_SCHEMA.validate({ include: { productIds: ['x'] } }).error === undefined, false);
    assert.equal(SCOPE_SCHEMA.validate({ include: { tags: ['x'] } }).error === undefined, false);
  });
});

describe('paymentEmail', () => {
  it('uses the customer\'s email when there is one', () => {
    assert.equal(paymentEmail('a@b.com', '+2348012345678', 'noemail.test'), 'a@b.com');
  });
  it('derives a stable placeholder from the hashed phone without exposing it', () => {
    const a = paymentEmail(null, '+2348012345678', 'noemail.test');
    assert.match(a, /^phone-[0-9a-f]{20}@noemail\.test$/);
    assert.equal(a, paymentEmail(undefined, '+2348012345678', 'noemail.test'));
    assert.notEqual(a, paymentEmail(null, '+2348099999999', 'noemail.test'));
    assert.ok(!a.includes('2348012345678'));
  });
});

describe('estimateFor', () => {
  const placed = new Date('2026-10-17T22:30:00Z'); // 23:30 in Lagos, still the 17th
  it('counts transit days from the local order date', () => {
    assert.deepEqual(estimateFor('same_day', placed), { earliestDate: '2026-10-17', latestDate: '2026-10-17' });
    assert.deepEqual(estimateFor('next_day', placed), { earliestDate: '2026-10-18', latestDate: '2026-10-18' });
    assert.deepEqual(estimateFor('nationwide', placed), { earliestDate: '2026-10-19', latestDate: '2026-10-21' });
  });
  it('rolls over to the next local date after midnight Lagos time', () => {
    assert.equal(estimateFor('same_day', new Date('2026-10-17T23:30:00Z'))!.earliestDate, '2026-10-18');
  });
  it('crosses month and year ends', () => {
    assert.equal(estimateFor('nationwide', new Date('2026-12-30T10:00:00Z'))!.latestDate, '2027-01-03');
  });
  it('respects another timezone', () => {
    assert.equal(estimateFor('same_day', new Date('2026-10-17T22:30:00Z'), undefined, 'UTC')!.earliestDate, '2026-10-17');
    assert.equal(estimateFor('same_day', new Date('2026-10-17T22:30:00Z'), undefined, 'Pacific/Auckland')!.earliestDate, '2026-10-18');
  });
  it('has no window for pickup or unknown methods', () => {
    assert.equal(estimateFor('pickup', placed), null);
    assert.equal(estimateFor('drone', placed), null);
  });
});
