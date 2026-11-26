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

  it('gives an automatic discount whatever its stored minimum spend', () => {
    const configs = [
      promo({ kind: 'percentage', configuration: { version: 1, percent: 10 }, minimumSubtotalMinor: 1_000_000 }),
      promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 100 }, minimumSubtotalMinor: 1_000_000 }),
      promo({ kind: 'buy_x_get_y', configuration: { version: 1, buy: 1, get: 1 }, minimumSubtotalMinor: 1_000_000 }),
    ];
    for (const p of configs) assert.deepEqual(run([line('a', P1, 1000, 2)], [p]).applied.map((a) => a.promotionId), [p.id], p.kind);
  });

  it('measures minimum spend on eligible lines', () => {
    const p = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 }, minimumSubtotalMinor: 5000, code: 'MIN', scope: { include: { productIds: [P1] } } });
    const r = run([line('a', P1, 2000), line('b', P2, 9000)], [p]);
    assert.equal(r.applied.length, 0);
    assert.deepEqual(r.rejectedCodes, [{ code: 'MIN', reason: 'MIN_SPEND_NOT_MET' }]);
  });

  /** Per line, the [promotion, amount] pairs taken off it. */
  const taken = (r: ReturnType<typeof run>) => r.allocations.map((a) => a.map((x) => [x.promotionId, x.amountMinor]));
  const only = (productId: string) => ({ include: { productIds: [productId] } });

  it('gives every item its own automatic discount', () => {
    const first = promo({ kind: 'percentage', configuration: { version: 1, percent: 20 }, scope: only(P1) });
    const second = promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 500 }, scope: only(P2) });
    assert.deepEqual(taken(run([line('a', P1, 10000), line('b', P2, 4000)], [first, second])), [[[first.id, 2000]], [[second.id, 500]]]);
  });

  it('takes an automatic fixed amount off every unit, never more than its price', () => {
    const off = promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 500 } });
    const r = run([line('a', P1, 10000, 3), line('b', P2, 300, 2)], [off]);
    assert.deepEqual(taken(r), [[[off.id, 1500]], [[off.id, 600]]]);
    assert.equal(r.applied[0]!.discountMinor, 2100);
  });

  it('applies the cap of an automatic percentage to each unit', () => {
    const capped = promo({ kind: 'percentage', configuration: { version: 1, percent: 50, maxDiscountMinor: 1000 } });
    assert.deepEqual(taken(run([line('a', P1, 10000, 2), line('b', P2, 1000)], [capped])), [[[capped.id, 2000]], [[capped.id, 500]]]);
  });

  it('gives each item the biggest of the automatic discounts that cover it, never the sum, whatever their priority', () => {
    const percent = promo({ kind: 'percentage', configuration: { version: 1, percent: 20 }, priority: 5 });
    const fixed = promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 1500 } });
    const r = run([line('dear', P1, 10000), line('cheap', P2, 4000)], [percent, fixed]);
    assert.deepEqual(taken(r), [[[percent.id, 2000]], [[fixed.id, 1500]]]);
    assert.deepEqual(r.applied.map((a) => [a.promotionId, a.discountMinor]), [[percent.id, 2000], [fixed.id, 1500]]);
  });

  it('breaks a tie by priority and leaves the loser out', () => {
    const low = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 }, priority: 1 });
    const high = promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 100 }, priority: 5 });
    assert.deepEqual(run([line('a', P1, 1000)], [low, high]).applied.map((a) => a.promotionId), [high.id]);
  });

  it('lets an automatic buy X get Y and a percentage each win the units they save most on', () => {
    const bogo = promo({ kind: 'buy_x_get_y', configuration: { version: 1, buy: 1, get: 1 } });
    const percent = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 } });
    const r = run([line('a', P1, 10000), line('b', P2, 4000)], [bogo, percent]);
    assert.deepEqual(taken(r), [[[percent.id, 1000]], [[bogo.id, 4000]]]);
  });

  it('takes the code off what is left after the automatic discounts', () => {
    const auto = promo({ kind: 'percentage', configuration: { version: 1, percent: 20 } });
    const code = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 }, code: 'TEN', priority: 9 });
    const r = run([line('a', P1, 100000)], [code, auto]);
    assert.deepEqual(taken(r), [[[auto.id, 20000], [code.id, 8000]]]);
    assert.deepEqual(r.applied.map((a) => a.code), [null, 'TEN']);
  });

  it('takes a fixed or capped code once for the order, spread over the reduced prices', () => {
    const auto = promo({ kind: 'percentage', configuration: { version: 1, percent: 50 }, scope: only(P1) });
    const fixed = promo({ kind: 'fixed_amount', configuration: { version: 1, amountMinor: 900 }, code: 'OFF' });
    assert.deepEqual(taken(run([line('a', P1, 10000), line('b', P2, 4000)], [auto, fixed])), [[[auto.id, 5000], [fixed.id, 500]], [[fixed.id, 400]]]);
    const capped = promo({ kind: 'percentage', configuration: { version: 1, percent: 50, maxDiscountMinor: 900 }, code: 'CAP' });
    assert.equal(run([line('a', P1, 10000, 2)], [capped]).applied[0]!.discountMinor, 900);
  });

  it('rewards a buy X get Y code at the reduced price, ignoring units that are already free', () => {
    const auto = promo({ kind: 'percentage', configuration: { version: 1, percent: 50 }, scope: only(P1) });
    const bogo = promo({ kind: 'buy_x_get_y', configuration: { version: 1, buy: 1, get: 1 }, code: 'BOGO' });
    const r = run([line('a', P1, 6000), line('b', P2, 4000)], [auto, bogo]);
    assert.deepEqual(taken(r), [[[auto.id, 3000], [bogo.id, 3000]], []]);
    const free = promo({ kind: 'percentage', configuration: { version: 1, percent: 100 }, scope: only(P1) });
    assert.deepEqual(run([line('a', P1, 6000), line('b', P2, 4000)], [free, bogo]).rejectedCodes, [{ code: 'BOGO', reason: 'NOT_APPLICABLE' }]);
  });

  it('allows only one code, turning down any other', () => {
    const first = promo({ kind: 'percentage', configuration: { version: 1, percent: 10 }, code: 'FIRST', priority: 2 });
    const second = promo({ kind: 'percentage', configuration: { version: 1, percent: 20 }, code: 'SECOND', priority: 1 });
    const r = run([line('a', P1, 1000)], [second, first]);
    assert.deepEqual(r.applied.map((a) => a.code), ['FIRST']);
    assert.deepEqual(r.rejectedCodes, [{ code: 'SECOND', reason: 'NOT_APPLICABLE' }]);
  });

  it('turns down a free delivery code when delivery is already free', () => {
    const auto = promo({ kind: 'free_delivery', configuration: { version: 1 } });
    const code = promo({ kind: 'free_delivery', configuration: { version: 1 }, code: 'SHIP', priority: 9 });
    const r = run([line('a', P1, 1000)], [code, auto]);
    assert.equal(r.freeDelivery?.promotionId, auto.id);
    assert.deepEqual(r.rejectedCodes, [{ code: 'SHIP', reason: 'NOT_APPLICABLE' }]);
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
