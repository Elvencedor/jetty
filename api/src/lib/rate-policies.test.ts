import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tooManyRequests } from './rate-limit.js';
import { LIMITS } from './rate-policies.js';

describe('rate policies', () => {
  it('every policy has a unique name and a positive limit and window', () => {
    const names = Object.values(LIMITS).map((p) => p.name);
    assert.equal(new Set(names).size, names.length);
    for (const p of Object.values(LIMITS)) {
      assert.ok(p.limit > 0 && Number.isInteger(p.limit), p.name);
      assert.ok(p.windowMs >= 60_000, p.name);
    }
  });

  it('account-level credential limits are stricter than the per-IP ones', () => {
    assert.ok(LIMITS.loginAccount.limit < LIMITS.login.limit);
    assert.ok(LIMITS.adminLoginAccount.limit < LIMITS.adminLogin.limit);
    assert.ok(LIMITS.passwordForgotAccount.limit < LIMITS.passwordForgot.limit);
  });
});

describe('tooManyRequests', () => {
  it('is a 429 RATE_LIMITED with a Retry-After header', () => {
    const err = tooManyRequests(42);
    assert.equal(err.output.statusCode, 429);
    assert.equal((err.data as { code: string }).code, 'RATE_LIMITED');
    assert.equal(err.output.headers['Retry-After'], '42');
  });
});
