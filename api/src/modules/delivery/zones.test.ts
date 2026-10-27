import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deliveryOptions, type DeliveryZone } from './zones.js';

const zone = (over: Partial<DeliveryZone> = {}): DeliveryZone => ({
  id: 'z',
  name: 'Lagos',
  state: 'Lagos',
  areas: [],
  active: true,
  sameDayCutoffLocal: '14:00',
  timezone: 'Africa/Lagos',
  sameDayFeeMinor: 300000,
  nextDayFeeMinor: 200000,
  nationwideFeeMinor: null,
  pickupEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

// Africa/Lagos is UTC+1 all year.
const at = (iso: string) => new Date(iso);

describe('deliveryOptions', () => {
  it('offers only configured methods, using the admin-set fees', () => {
    const methods = deliveryOptions(zone(), at('2026-10-17T09:00:00Z')).map((o) => [o.method, o.baseFeeMinor]);
    assert.deepEqual(methods, [['same_day', 300000], ['next_day', 200000], ['pickup', 0]]);
  });

  it('allows same day before the local cutoff and blocks it from the cutoff onward', () => {
    const before = deliveryOptions(zone(), at('2026-10-17T12:59:00Z')).find((o) => o.method === 'same_day')!;
    assert.equal(before.available, true);
    assert.deepEqual(before.estimate, { earliestDate: '2026-10-17', latestDate: '2026-10-17' });
    const after = deliveryOptions(zone(), at('2026-10-17T13:00:00Z')).find((o) => o.method === 'same_day')!;
    assert.equal(after.available, false);
    assert.equal(after.reason, 'CUTOFF_PASSED');
  });

  it('computes estimates in the zone timezone, not UTC', () => {
    const o = deliveryOptions(zone({ nationwideFeeMinor: 500000 }), at('2026-10-17T23:30:00Z'));
    assert.deepEqual(o.find((x) => x.method === 'next_day')!.estimate, { earliestDate: '2026-10-19', latestDate: '2026-10-19' });
    assert.deepEqual(o.find((x) => x.method === 'nationwide')!.estimate, { earliestDate: '2026-10-20', latestDate: '2026-10-22' });
  });

  it('treats a missing cutoff as always eligible and an invalid one as unavailable', () => {
    assert.equal(deliveryOptions(zone({ sameDayCutoffLocal: null }), at('2026-10-17T22:00:00Z'))[0]!.available, true);
    assert.equal(deliveryOptions(zone({ sameDayCutoffLocal: 'soon' }), at('2026-10-17T08:00:00Z'))[0]!.available, false);
  });

  it('offers nothing when no fee is configured and pickup is off', () => {
    const empty = zone({ sameDayFeeMinor: null, nextDayFeeMinor: null, pickupEnabled: false });
    assert.deepEqual(deliveryOptions(empty), []);
  });
});
