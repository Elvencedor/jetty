import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { latestPrep, prepStart, type PrepTime } from './prep.js';

const prep = (over: Partial<PrepTime> = {}): PrepTime => ({
  id: 'p', name: 'Rush', active: true, mode: 'days', days: 10, deliversFrom: null, activeFrom: null, activeUntil: null, appliesTo: 'all', zoneIds: [],
  createdAt: new Date(0), updatedAt: new Date(0), ...over,
});

describe('prepStart', () => {
  it('starts deliveries after the prep days, or on the fixed date', () => {
    assert.deepEqual(prepStart(prep(), '2026-11-20'), { startsOn: '2026-11-30', days: 10 });
    assert.deepEqual(prepStart(prep({ mode: 'date', deliversFrom: '2026-12-15' }), '2026-11-20'), { startsOn: '2026-12-15', days: null });
  });
  it('does not apply when off, outside its start and end, or once the fixed date has come', () => {
    assert.equal(prepStart(prep({ active: false }), '2026-11-20'), null);
    assert.equal(prepStart(prep({ activeFrom: '2026-12-01' }), '2026-11-20'), null);
    assert.equal(prepStart(prep({ activeUntil: '2026-11-19' }), '2026-11-20'), null);
    assert.notEqual(prepStart(prep({ activeFrom: '2026-11-20', activeUntil: '2026-11-20' }), '2026-11-20'), null);
    assert.equal(prepStart(prep({ mode: 'date', deliversFrom: '2026-11-20' }), '2026-11-20'), null);
    assert.equal(prepStart(prep({ mode: 'date' }), '2026-11-20'), null);
  });
});

describe('latestPrep', () => {
  it('applies to every zone, or only the zones chosen', () => {
    const all = prep({ id: 'a', days: 5 });
    const some = prep({ id: 'b', days: 12, appliesTo: 'zones', zoneIds: ['z1'] });
    assert.equal(latestPrep([all, some], 'z2', '2026-11-20')!.days, 5);
    assert.equal(latestPrep([all, some], 'z1', '2026-11-20')!.days, 12, 'the longest wait wins');
    assert.equal(latestPrep([some], 'z2', '2026-11-20'), null);
  });
});
