import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocate } from './allocate.js';
import { applyPromotions, type EngineLine, type EnginePromotion } from './promotions.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const COL = '33333333-3333-4333-8333-333333333333';
const ZONE = '44444444-4444-4444-8444-444444444444';

const line = (variantId: string, productId: string, unit: number, quantity = 1, collectionIds: string[] = []): EngineLine => ({
  variantId,
  productId,
  collectionIds,
  quantity,
  unitPriceMinor: unit,
});

let n = 0;
const promo = (over: Partial<EnginePromotion> & Pick<EnginePromotion, 'kind' | 'configuration'>): EnginePromotion => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  name: `promo-${n}`,
  scope: {},
  priority: 0,
  stackable: false,
  minimumSubtotalMinor: null,
  currency: 'NGN',
  createdAt: new Date(2026, 0, n),
  code: null,
  ...over,
});

const run = (lines: EngineLine[], promotions: EnginePromotion[], zoneId?: string) =>
  applyPromotions({ lines, promotions, currency: 'NGN', zoneId });

describe('allocate', () => {
  it('sums exactly to the total and never exceeds a weight', () => {
    const parts = allocate(100, [1, 1, 1]);
    assert.equal(parts.reduce((a, b) => a + b, 0), 100);
    const capped = allocate(7, [3, 3, 1]);
    assert.equal(capped.reduce((a, b) => a + b, 0), 7);
    capped.forEach((p, i) => assert.ok(p <= [3, 3, 1][i]!));
  });
  it('handles empty and zero input and large values', () => {
    assert.deepEqual(allocate(0, [5, 5]), [0, 0]);
    assert.deepEqual(allocate(5, [0, 0]), [0, 0]);
    assert.equal(allocate(9_000_000_000_000, [4_000_000_000_000, 5_000_000_000_000]).reduce((a, b) => a + b, 0), 9_000_000_000_000);
  });
});

describe('promotion engine', () => {
  it('applies a percentage discount and allocates across lines', () => {
    const r = run([line('a', P1, 10000), line('b', P2, 5000, 2)], [promo({ kind: 'percentage', configuration: { version: 1, percent: 10 } })]);
    assert.equal(r.applied[0]!.discountMinor, 2000);
    assert.deepEqual(r.allocations.map((a) => a.reduce((s, x) => s + x.amountMinor, 0)), [1000, 1000]);
  });

  it('caps percentage discounts with maxDiscountMinor', () => {
    const r = run([line('a', P1, 100000)], [promo({ kind: 'percentage', configuration: { version: 1, percent: 50, maxDiscountMinor: 5000 } })]);
    assert.equal(r.applied[0]!.discountMinor, 5000);
  });

  it('never discounts below zero for fixed amounts', () => {
    const r = run([line('a', P1, 3000)], [promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 10000 } })]);
    assert.equal(r.applied[0]!.discountMinor, 3000);
  });

  it('makes the cheapest unit free for buy 2 get 1', () => {
    const r = run(
      [line('a', P1, 10000, 2), line('b', P2, 4000)],
      [promo({ kind: 'buy_x_get_y', configuration: { version: 1, buy: 2, get: 1 } })],
    );
    assert.equal(r.applied[0]!.discountMinor, 4000);
    assert.deepEqual(r.allocations[1]!.map((a) => a.amountMinor), [4000]);
  });

  it('gives no BOGO discount until the group is complete', () => {
    const r = run([line('a', P1, 10000, 2)], [promo({ kind: 'buy_x_get_y', configuration: { version: 1, buy: 2, get: 1 }, code: 'BOGO' })]);
    assert.equal(r.applied.length, 0);
    assert.deepEqual(r.rejectedCodes, [{ code: 'BOGO', reason: 'NOT_APPLICABLE' }]);
  });

  it('honours scope include, collections and exclusions', () => {
    const lines = [line('a', P1, 1000, 1, [COL]), line('b', P2, 1000)];
    const byCollection = run(lines, [promo({ kind: 'percentage', configuration: { version: 1, percent: 100 }, scope: { include: { collectionIds: [COL] } } })]);
    assert.equal(byCollection.applied[0]!.discountMinor, 1000);
    const excluded = run(lines, [promo({ kind: 'percentage', configuration: { version: 1, percent: 100 }, scope: { excludeProductIds: [P1] } })]);
    assert.equal(excluded.applied[0]!.discountMinor, 1000);
    assert.equal(excluded.allocations[0]!.length, 0);
  });

  it('measures minimum spend on eligible lines', () => {
    const p = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 }, minimumSubtotalMinor: 5000, code: 'MIN', scope: { include: { productIds: [P1] } } });
    const r = run([line('a', P1, 2000), line('b', P2, 9000)], [p]);
    assert.equal(r.applied.length, 0);
    assert.deepEqual(r.rejectedCodes, [{ code: 'MIN', reason: 'MIN_SPEND_NOT_MET' }]);
  });

  it('does not stack non-stackable promotions; higher priority wins', () => {
    const low = promo({ kind: 'percentage', configuration: { version: 1, percent: 50 }, priority: 1, code: 'LOW' });
    const high = promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 100 }, priority: 5 });
    const r = run([line('a', P1, 1000)], [low, high]);
    assert.deepEqual(r.applied.map((a) => a.promotionId), [high.id]);
    assert.deepEqual(r.rejectedCodes, [{ code: 'LOW', reason: 'NOT_APPLICABLE' }]);
  });

  it('stacks only when every involved promotion is stackable, on the reduced amount', () => {
    const a = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 }, stackable: true, priority: 2 });
    const b = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 }, stackable: true, priority: 1 });
    const r = run([line('x', P1, 10000)], [b, a]);
    assert.deepEqual(r.applied.map((p) => p.discountMinor), [1000, 900]);
  });

  it('is deterministic regardless of input order', () => {
    const a = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 } });
    const b = promo({ kind: 'percentage', configuration: { version: 1, percent: 20 } });
    const l = [line('x', P1, 1000)];
    assert.deepEqual(run(l, [a, b]).applied, run(l, [b, a]).applied);
  });

  it('applies free delivery by zone and minimum spend, independent of line discounts', () => {
    const fd = promo({ kind: 'free_delivery', configuration: { version: 1, zoneIds: [ZONE] }, minimumSubtotalMinor: 5000 });
    const discount = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 } });
    assert.equal(run([line('a', P1, 6000)], [fd, discount], ZONE).freeDelivery?.promotionId, fd.id);
    assert.equal(run([line('a', P1, 6000)], [fd, discount], ZONE).applied.length, 1);
    assert.equal(run([line('a', P1, 6000)], [fd], P1).freeDelivery, null);
    assert.equal(run([line('a', P1, 6000)], [fd]).freeDelivery, null);
    assert.equal(run([line('a', P1, 1000)], [fd], ZONE).freeDelivery, null);
  });

  it('ignores promotions with invalid configuration or a different currency', () => {
    const bad = promo({ kind: 'percentage', configuration: { version: 1, percent: 500 }, code: 'BAD' });
    const usd = promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 100 }, currency: 'USD' });
    const r = run([line('a', P1, 1000)], [bad, usd]);
    assert.equal(r.applied.length, 0);
    assert.deepEqual(r.rejectedCodes, [{ code: 'BAD', reason: 'NOT_APPLICABLE' }]);
  });
});

describe('free gifts', () => {
  const GIFT = '55555555-5555-4555-8555-555555555555';
  const gift = (over: Partial<EnginePromotion> = {}) => promo({ kind: 'free_gift', configuration: { version: 1, variantId: GIFT, quantity: 1 }, ...over });

  it('adds the item the rule names, without touching the cart lines', () => {
    const r = run([line('a', P1, 100_000)], [gift({ name: 'Free bonnet' })]);
    assert.deepEqual(r.gifts.map((g) => [g.name, g.variantId, g.quantity]), [['Free bonnet', GIFT, 1]]);
    assert.deepEqual(r.allocations, [[]]);
    assert.deepEqual(r.applied, [], 'the cart reports it once it has priced the item');
  });

  it('respects scope and minimum spend like any other promotion', () => {
    assert.equal(run([line('a', P1, 100_000, 1, [COL])], [gift({ scope: { include: { collectionIds: [COL] } } })]).gifts.length, 1);
    assert.equal(run([line('a', P1, 100_000)], [gift({ scope: { include: { collectionIds: [COL] } } })]).gifts.length, 0);
    assert.equal(run([line('a', P1, 100_000)], [gift({ minimumSubtotalMinor: 150_000, code: 'GIFT' })]).rejectedCodes[0]?.reason, 'MIN_SPEND_NOT_MET');
    assert.equal(run([line('a', P1, 100_000)], [gift({ minimumSubtotalMinor: 100_000 })]).gifts.length, 1);
  });

  it('combines with a discount and with free delivery, whatever they allow', () => {
    const r = run([line('a', P1, 100_000)], [promo({ kind: 'percentage', configuration: { version: 1, percent: 10 } }), gift(), promo({ kind: 'free_delivery', configuration: { version: 1 } })]);
    assert.equal(r.applied.length, 1);
    assert.equal(r.gifts.length, 1);
    assert.ok(r.freeDelivery);
  });

  it('gives a gift from every promotion that earns one', () => {
    assert.equal(run([line('a', P1, 100_000)], [gift(), gift()]).gifts.length, 2);
  });
});
