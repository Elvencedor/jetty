import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { deriveToken, hmacSha256, newOpaqueSecret, sameHash, sha256, signAccessToken, verifyAccessToken } from './tokens.js';

const SECRET = 'a'.repeat(32);
const NOW = new Date('2026-06-01T12:00:00Z');
const exp = (offsetSeconds: number) => Math.floor(NOW.getTime() / 1000) + offsetSeconds;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('hashing helpers', () => {
  it('sha256 is the known hex digest', () => {
    assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('hmacSha256 depends on the secret', () => {
    assert.equal(hmacSha256('k', 'v'), hmacSha256('k', 'v'));
    assert.notEqual(hmacSha256('k', 'v'), hmacSha256('k2', 'v'));
    assert.notEqual(hmacSha256('k', 'v'), hmacSha256('k', 'v2'));
  });
  it('deriveToken is deterministic and separated by label', () => {
    assert.equal(deriveToken('s', 'refresh', 'x'), deriveToken('s', 'refresh', 'x'));
    assert.notEqual(deriveToken('s', 'refresh', 'x'), deriveToken('s', 'access', 'x'));
    assert.match(deriveToken('s', 'l', 'v'), /^[\w-]+$/);
  });
  it('newOpaqueSecret is long, url-safe and unique', () => {
    const a = newOpaqueSecret();
    assert.match(a, /^[\w-]{43}$/);
    assert.notEqual(a, newOpaqueSecret());
  });
  it('sameHash compares by value and tolerates different lengths', () => {
    assert.equal(sameHash('abc', 'abc'), true);
    assert.equal(sameHash('abc', 'abd'), false);
    assert.equal(sameHash('abc', 'abcd'), false);
    assert.equal(sameHash('', ''), true);
  });
});

describe('access tokens', () => {
  const claims = { sub: 'customer-1', sid: 'session-1', exp: exp(900) };

  it('round-trips valid claims', () => {
    const token = signAccessToken(claims, SECRET);
    assert.equal(token.split('.').length, 3);
    assert.deepEqual(verifyAccessToken(token, SECRET, NOW), claims);
  });

  it('rejects a token signed with a different secret', () => {
    assert.equal(verifyAccessToken(signAccessToken(claims, SECRET), 'b'.repeat(32), NOW), null);
  });

  it('rejects an expired token, including at the exact expiry second', () => {
    assert.equal(verifyAccessToken(signAccessToken({ ...claims, exp: exp(-1) }, SECRET), SECRET, NOW), null);
    assert.equal(verifyAccessToken(signAccessToken({ ...claims, exp: exp(0) }, SECRET), SECRET, NOW), null);
    assert.ok(verifyAccessToken(signAccessToken({ ...claims, exp: exp(1) }, SECRET), SECRET, NOW));
  });

  it('rejects tampered claims', () => {
    const [h, , s] = signAccessToken(claims, SECRET).split('.');
    const forged = `${h}.${b64({ ...claims, sub: 'admin' })}.${s}`;
    assert.equal(verifyAccessToken(forged, SECRET, NOW), null);
  });

  it('never honours a forged alg header, such as none', () => {
    const header = b64({ alg: 'none', typ: 'JWT' });
    const body = b64(claims);
    assert.equal(verifyAccessToken(`${header}.${body}.`, SECRET, NOW), null);
    const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    assert.equal(verifyAccessToken(`${header}.${body}.${sig}`, SECRET, NOW), null);
  });

  it('rejects malformed tokens', () => {
    for (const t of ['', 'abc', 'a.b', 'a.b.c.d', '..']) assert.equal(verifyAccessToken(t, SECRET, NOW), null, t);
  });

  it('rejects a correctly signed token with missing or mistyped claims', () => {
    const header = signAccessToken(claims, SECRET).split('.')[0]!;
    const forge = (payload: unknown) => {
      const body = `${header}.${b64(payload)}`;
      return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    };
    assert.equal(verifyAccessToken(forge({ sub: 'a', sid: 'b' }), SECRET, NOW), null);
    assert.equal(verifyAccessToken(forge({ sub: 1, sid: 'b', exp: exp(60) }), SECRET, NOW), null);
    assert.equal(verifyAccessToken(forge({ sub: 'a', sid: 'b', exp: '9999999999' }), SECRET, NOW), null);
    const notJson = `${header}.${Buffer.from('not json').toString('base64url')}`;
    const sig = createHmac('sha256', SECRET).update(notJson).digest('base64url');
    assert.equal(verifyAccessToken(`${notJson}.${sig}`, SECRET, NOW), null);
  });

  it('drops extra claims', () => {
    const header = signAccessToken(claims, SECRET).split('.')[0]!;
    const body = `${header}.${b64({ ...claims, role: 'admin' })}`;
    const token = `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    assert.deepEqual(verifyAccessToken(token, SECRET, NOW), claims);
  });
});
