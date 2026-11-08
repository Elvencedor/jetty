import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_NAMES, eventSchema } from './events.js';

const U = '11111111-1111-4111-8111-111111111111';
const event = (over: Record<string, unknown> = {}) => ({ name: 'product_view', anonymousId: 'anon-12345', sessionId: 'sess-12345', ...over });
const validate = (events: unknown[], earliest = new Date('2020-01-01')) => eventSchema.validate({ events }, { context: { earliest } });

describe('analytics event schema', () => {
  it('accepts the four storefront events and never "purchase"', () => {
    assert.deepEqual([...EVENT_NAMES], ['session_start', 'product_view', 'add_to_bag', 'checkout_start']);
    for (const name of EVENT_NAMES) assert.equal(validate([event({ name })]).error, undefined, name);
    assert.ok(validate([event({ name: 'purchase' })]).error);
  });

  it('defaults properties to an empty object', () => {
    assert.deepEqual(validate([event()]).value.events[0].properties, {});
  });

  it('allows only a fixed set of property keys', () => {
    assert.equal(validate([event({ properties: { productId: U, variantId: U, quantity: 2, source: 'search' } })]).error, undefined);
    assert.ok(validate([event({ properties: { email: 'a@b.com' } })]).error);
    assert.ok(validate([event({ properties: { productId: 'not-uuid' } })]).error);
    assert.ok(validate([event({ properties: { quantity: 0 } })]).error);
    assert.ok(validate([event({ properties: { quantity: 100 } })]).error);
    assert.ok(validate([event({ properties: { source: 'x'.repeat(41) } })]).error);
  });

  it('constrains anonymous and session ids', () => {
    assert.ok(validate([event({ anonymousId: 'short' })]).error);
    assert.ok(validate([event({ sessionId: 'has spaces here' })]).error);
    assert.ok(validate([event({ anonymousId: 'x'.repeat(65) })]).error);
    assert.ok(validate([event({ sessionId: undefined })]).error);
  });

  it('takes 1 to 20 events per batch', () => {
    assert.ok(validate([]).error);
    assert.equal(validate(Array.from({ length: 20 }, () => event())).error, undefined);
    assert.ok(validate(Array.from({ length: 21 }, () => event())).error);
    assert.ok(eventSchema.validate({}).error);
  });

  it('rejects timestamps in the future or older than the retention bound', () => {
    const earliest = new Date('2026-01-01T00:00:00Z');
    assert.equal(validate([event({ occurredAt: '2026-06-01T00:00:00Z' })], earliest).error, undefined);
    assert.ok(validate([event({ occurredAt: '2025-12-31T23:59:59Z' })], earliest).error);
    assert.ok(validate([event({ occurredAt: new Date(Date.now() + 3_600_000).toISOString() })], earliest).error);
    assert.ok(validate([event({ occurredAt: 'yesterday' })], earliest).error);
  });
});
