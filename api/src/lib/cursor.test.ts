import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeCursor, encodeCursor } from './cursor.js';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { data?: { code?: string }; output: { statusCode: number } });
  }
  assert.fail('expected a throw');
};

describe('keyset cursors', () => {
  it('round-trips the sort-key values', () => {
    const cursor = encodeCursor({ sort: 'price_asc', values: ['1999', 'abc'] });
    assert.deepEqual(decodeCursor(cursor, 'price_asc', 2), ['1999', 'abc']);
  });

  it('is URL-safe and opaque', () => {
    const cursor = encodeCursor({ sort: 'newest', values: ['2026-01-01T00:00:00.000Z', '???>>>~~~'] });
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  });

  it('rejects a cursor minted for a different sort', () => {
    const cursor = encodeCursor({ sort: 'newest', values: ['a'] });
    const e = code(() => decodeCursor(cursor, 'price_asc', 1));
    assert.equal(e.output.statusCode, 400);
    assert.equal(e.data?.code, 'BAD_REQUEST');
  });

  it('rejects a cursor with the wrong number of values', () => {
    const cursor = encodeCursor({ sort: 'newest', values: ['a', 'b'] });
    assert.equal(code(() => decodeCursor(cursor, 'newest', 1)).output.statusCode, 400);
    assert.equal(code(() => decodeCursor(cursor, 'newest', 3)).output.statusCode, 400);
  });

  it('rejects non-string values', () => {
    const cursor = Buffer.from(JSON.stringify({ sort: 'newest', values: [1] })).toString('base64url');
    assert.equal(code(() => decodeCursor(cursor, 'newest', 1)).output.statusCode, 400);
  });

  it('rejects garbage, empty, null and non-object payloads', () => {
    assert.equal(code(() => decodeCursor('not base64 json!!', 'newest', 1)).output.statusCode, 400);
    assert.equal(code(() => decodeCursor('', 'newest', 1)).output.statusCode, 400);
    const asNull = Buffer.from('null').toString('base64url');
    assert.equal(code(() => decodeCursor(asNull, 'newest', 1)).output.statusCode, 400);
    const noValues = Buffer.from(JSON.stringify({ sort: 'newest' })).toString('base64url');
    assert.equal(code(() => decodeCursor(noValues, 'newest', 0)).output.statusCode, 400);
  });

  it('accepts an empty value list when none are expected', () => {
    assert.deepEqual(decodeCursor(encodeCursor({ sort: 'x', values: [] }), 'x', 0), []);
  });
});
