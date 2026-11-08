import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAYMENT_METHODS, SETTINGS, SETTING_KEYS, isSettingKey } from './settings.js';

const ok = (key: keyof typeof SETTINGS, value: unknown) => SETTINGS[key].schema.validate(value).error === undefined;

describe('settings registry', () => {
  it('knows exactly the allow-listed keys', () => {
    assert.deepEqual([...SETTING_KEYS].sort(), ['payments', 'policies', 'store']);
    assert.equal(isSettingKey('store'), true);
    assert.equal(isSettingKey('secrets'), false);
    assert.equal(isSettingKey('__proto__'), false);
  });

  it('ships defaults that satisfy their own schema', () => {
    for (const key of SETTING_KEYS) assert.equal(ok(key, SETTINGS[key].defaults), true, key);
  });

  it('exposes every setting publicly', () => {
    for (const key of SETTING_KEYS) assert.equal(SETTINGS[key].public, true);
  });
});

describe('store settings', () => {
  it('accepts partial updates and trims', () => {
    const { value, error } = SETTINGS.store.schema.validate({ name: '  Jetty  ' });
    assert.equal(error, undefined);
    assert.equal(value.name, 'Jetty');
  });
  it('requires a non-empty name of at most 80 characters', () => {
    assert.equal(ok('store', { name: '' }), false);
    assert.equal(ok('store', { name: 'x'.repeat(81) }), false);
    assert.equal(ok('store', { name: 'x'.repeat(80) }), true);
  });
  it('validates the contact email but allows clearing it', () => {
    assert.equal(ok('store', { contactEmail: 'hello@jettyshair.com' }), true);
    assert.equal(ok('store', { contactEmail: '' }), true);
    assert.equal(ok('store', { contactEmail: 'not-an-email' }), false);
  });
  it('requires E.164 phone numbers but allows clearing them', () => {
    assert.equal(ok('store', { contactPhone: '+2348012345678' }), true);
    assert.equal(ok('store', { whatsappNumber: '' }), true);
    for (const bad of ['08012345678', '+0123456789', '+234 801 234 5678', '+12', '+1234567890123456']) {
      assert.equal(ok('store', { contactPhone: bad }), false, bad);
    }
  });
  it('caps address and hours length', () => {
    assert.equal(ok('store', { showroomAddress: 'x'.repeat(300) }), true);
    assert.equal(ok('store', { showroomAddress: 'x'.repeat(301) }), false);
    assert.equal(ok('store', { showroomHours: 'x'.repeat(201) }), false);
  });
  it('rejects unknown fields', () => {
    assert.equal(ok('store', { admin: true }), false);
  });
});

describe('policy settings', () => {
  it('bounds the return window to 0-90 whole days', () => {
    assert.equal(ok('policies', { returnWindowDays: 0 }), true);
    assert.equal(ok('policies', { returnWindowDays: 90 }), true);
    assert.equal(ok('policies', { returnWindowDays: 91 }), false);
    assert.equal(ok('policies', { returnWindowDays: -1 }), false);
    assert.equal(ok('policies', { returnWindowDays: 7.5 }), false);
  });
  it('allows the pay-on-delivery limit to be a non-negative integer or null (off)', () => {
    assert.equal(ok('policies', { podMaxOrderMinor: null }), true);
    assert.equal(ok('policies', { podMaxOrderMinor: 0 }), true);
    assert.equal(ok('policies', { podMaxOrderMinor: 5_000_000 }), true);
    assert.equal(ok('policies', { podMaxOrderMinor: -1 }), false);
    assert.equal(ok('policies', { podMaxOrderMinor: 10.5 }), false);
  });
  it('defaults to no pay-on-delivery limit and a 7-day window', () => {
    assert.equal(SETTINGS.policies.defaults.podMaxOrderMinor, null);
    assert.equal(SETTINGS.policies.defaults.returnWindowDays, 7);
  });
});

describe('payment settings', () => {
  it('enables card and bank transfer by default with sensible holds', () => {
    assert.deepEqual(SETTINGS.payments.defaults.enabledMethods, [...PAYMENT_METHODS]);
    assert.equal(SETTINGS.payments.defaults.cardHoldMinutes, 30);
    assert.equal(SETTINGS.payments.defaults.transferHoldMinutes, 45);
  });
  it('needs at least one known, unique payment method', () => {
    assert.equal(ok('payments', { enabledMethods: ['card'] }), true);
    assert.equal(ok('payments', { enabledMethods: ['bank_transfer', 'card'] }), true);
    assert.equal(ok('payments', { enabledMethods: [] }), false);
    assert.equal(ok('payments', { enabledMethods: ['card', 'card'] }), false);
    assert.equal(ok('payments', { enabledMethods: ['cash'] }), false);
  });
  it('keeps stock holds between 15 minutes and 8 hours', () => {
    for (const field of ['cardHoldMinutes', 'transferHoldMinutes']) {
      assert.equal(ok('payments', { [field]: 15 }), true, field);
      assert.equal(ok('payments', { [field]: 480 }), true, field);
      assert.equal(ok('payments', { [field]: 14 }), false, field);
      assert.equal(ok('payments', { [field]: 481 }), false, field);
      assert.equal(ok('payments', { [field]: 30.5 }), false, field);
    }
  });
});
