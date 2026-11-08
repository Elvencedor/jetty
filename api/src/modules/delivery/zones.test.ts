import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deliveryOptions, estimateFor, promisedDays, type DeliveryZone } from './zones.js';

const zone = (over: Partial<DeliveryZone> = {}): DeliveryZone => ({
  id: 'z',
  name: 'Lagos',
  scope: 'state',
  state: 'Lagos',
  states: [],
  areas: [],
  active: true,
  timezone: 'Africa/Lagos',
  deliveryFeeMinor: 300000,
  deliveryMinDays: 1,
  deliveryMaxDays: 3,
  sameDayCutoffLocal: null,
  sameDayFeeMinor: null,
  nextDayFeeMinor: null,
  nationwideFeeMinor: null,
  pickupEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

// Africa/Lagos is UTC+1 all year.
const at = (iso: string) => new Date(iso);

describe('deliveryOptions', () => {
  it('offers delivery at the zone price, then pickup', () => {
    const methods = deliveryOptions(zone(), at('2026-10-17T09:00:00Z')).map((o) => [o.method, o.baseFeeMinor]);
    assert.deepEqual(methods, [['delivery', 300000], ['pickup', 0]]);
  });

  it('counts the admin-set duration from the local date', () => {
    const delivery = deliveryOptions(zone({ deliveryMinDays: 2, deliveryMaxDays: 4 }), at('2026-10-17T09:00:00Z'))[0]!;
    assert.deepEqual(delivery.estimate, { earliestDate: '2026-10-19', latestDate: '2026-10-21' });
  });

  it('computes estimates in the zone timezone, not UTC', () => {
    // 23:30 UTC is 00:30 the next day in Lagos.
    const delivery = deliveryOptions(zone({ deliveryMinDays: 0, deliveryMaxDays: 0 }), at('2026-10-17T23:30:00Z'))[0]!;
    assert.deepEqual(delivery.estimate, { earliestDate: '2026-10-18', latestDate: '2026-10-18' });
  });

  it('treats a free delivery price as offered', () => {
    assert.deepEqual(deliveryOptions(zone({ deliveryFeeMinor: 0, pickupEnabled: false })).map((o) => [o.method, o.baseFeeMinor]), [['delivery', 0]]);
  });

  it('offers pickup only when there is no delivery price', () => {
    assert.deepEqual(deliveryOptions(zone({ deliveryFeeMinor: null })).map((o) => o.method), ['pickup']);
  });

  it('offers nothing when there is no price and pickup is off', () => {
    assert.deepEqual(deliveryOptions(zone({ deliveryFeeMinor: null, pickupEnabled: false })), []);
  });
});

describe('estimateFor', () => {
  const placed = at('2026-10-17T09:00:00Z');
  it('uses the days saved with the order', () => {
    assert.deepEqual(estimateFor('delivery', placed, { minDays: 2, maxDays: 5 }), { earliestDate: '2026-10-19', latestDate: '2026-10-22' });
  });
  it('has no window when the order saved no days', () => {
    assert.equal(estimateFor('delivery', placed), null);
  });
  it('keeps the old windows for orders placed under the old methods', () => {
    assert.deepEqual(estimateFor('same_day', placed), { earliestDate: '2026-10-17', latestDate: '2026-10-17' });
    assert.deepEqual(estimateFor('nationwide', placed), { earliestDate: '2026-10-19', latestDate: '2026-10-21' });
  });
  it('has no window for pickup', () => {
    assert.equal(estimateFor('pickup', placed, { minDays: 1, maxDays: 2 }), null);
  });
});

describe('promisedDays', () => {
  it('reads the days from an order snapshot and ignores anything else', () => {
    assert.deepEqual(promisedDays({ deliveryMinDays: 1, deliveryMaxDays: 3, state: 'Lagos' }), { minDays: 1, maxDays: 3 });
    assert.deepEqual(promisedDays({ deliveryMinDays: '1' }), {});
    assert.deepEqual(promisedDays(null), {});
  });
});
