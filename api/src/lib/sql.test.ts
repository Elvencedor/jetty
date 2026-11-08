import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeLike, likeContains, uniqueViolation } from './sql.js';

describe('LIKE escaping', () => {
  it('escapes backslash, percent and underscore', () => {
    assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  });
  it('leaves ordinary text alone', () => {
    assert.equal(escapeLike('closure wig'), 'closure wig');
    assert.equal(escapeLike(''), '');
  });
  it('likeContains wraps the escaped text', () => {
    assert.equal(likeContains('a_b'), '%a\\_b%');
    assert.equal(likeContains(''), '%%');
  });
});

describe('uniqueViolation', () => {
  it('reads a driver error carrying the code directly', () => {
    assert.equal(uniqueViolation({ code: '23505', constraint_name: 'products_slug_key' }), 'products_slug_key');
  });
  it('reads a wrapped (drizzle) error through cause', () => {
    assert.equal(uniqueViolation({ cause: { code: '23505', constraint_name: 'c1' } }), 'c1');
  });
  it('falls back to a generic name when the constraint is unknown', () => {
    assert.equal(uniqueViolation({ code: '23505' }), 'unique');
  });
  it('ignores other errors', () => {
    assert.equal(uniqueViolation({ code: '23503' }), undefined);
    assert.equal(uniqueViolation(new Error('boom')), undefined);
    assert.equal(uniqueViolation({ cause: { code: '40001' } }), undefined);
  });
});
