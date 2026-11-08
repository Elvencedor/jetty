import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from '@hapi/hapi';
import { assertIfMatch, etagFor, guard, pageQuery, slugSchema, uuidParam } from './shared.js';

const withHeader = (value?: string) => ({ headers: value === undefined ? {} : { 'if-match': value } }) as unknown as Request;
const statusOf = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return (e as { output: { statusCode: number } }).output.statusCode;
  }
  return 0;
};

describe('ETags and If-Match', () => {
  it('derives a quoted ETag from the version timestamp', () => {
    assert.equal(etagFor(new Date(1_700_000_000_000)), '"1700000000000"');
    assert.equal(etagFor('2026-01-01T00:00:00.000Z'), `"${Date.parse('2026-01-01T00:00:00.000Z')}"`);
  });
  it('requires the header (428)', () => {
    assert.equal(statusOf(() => assertIfMatch(withHeader(), '"1"')), 428);
  });
  it('rejects a stale version (412)', () => {
    assert.equal(statusOf(() => assertIfMatch(withHeader('"0"'), '"1"')), 412);
  });
  it('accepts the current version, strong or weak', () => {
    assert.equal(statusOf(() => assertIfMatch(withHeader('"1"'), '"1"')), 0);
    assert.equal(statusOf(() => assertIfMatch(withHeader('W/"1"'), '"1"')), 0);
  });
  it('does not treat * or unquoted values as a match', () => {
    assert.equal(statusOf(() => assertIfMatch(withHeader('*'), '"1"')), 412);
    assert.equal(statusOf(() => assertIfMatch(withHeader('1'), '"1"')), 412);
  });
});

describe('route helpers', () => {
  it('guard marks a route for admin auth with the given permissions', () => {
    assert.deepEqual(guard('orders:read', 'orders:write'), { auth: 'admin', plugins: { permission: ['orders:read', 'orders:write'] } });
  });
  it('uuidParam validates a named UUID path parameter', () => {
    const schema = uuidParam('id');
    assert.equal(schema.validate({ id: '11111111-1111-4111-8111-111111111111' }).error, undefined);
    assert.ok(schema.validate({ id: 'nope' }).error);
    assert.ok(schema.validate({}).error);
  });
  it('slugSchema lower-cases and trims, then requires kebab-case', () => {
    assert.equal(slugSchema.validate('  Closure-Wigs ').value, 'closure-wigs');
    for (const bad of ['', 'a--b', '-a', 'a-', 'a b', 'a_b', 'x'.repeat(161)]) assert.ok(slugSchema.validate(bad).error, bad);
  });
  it('pageQuery exposes limit and cursor', () => {
    assert.ok('limit' in pageQuery && 'cursor' in pageQuery);
  });
});
