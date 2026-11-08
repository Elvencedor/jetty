import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from './password.js';

describe('passwords', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    assert.equal(await verifyPassword('correct horse battery', hash), true);
    assert.equal(await verifyPassword('Correct horse battery', hash), false);
    assert.equal(await verifyPassword('', hash), false);
  });

  it('stores a self-describing scrypt hash and never the password', async () => {
    const hash = await hashPassword('s3cret-pass');
    const [scheme, n, r, p, salt, key] = hash.split('$');
    assert.equal(scheme, 'scrypt');
    assert.equal(n, String(2 ** 15));
    assert.equal(r, '8');
    assert.equal(p, '1');
    assert.ok(salt && key);
    assert.ok(!hash.includes('s3cret-pass'));
  });

  it('salts every hash, so equal passwords hash differently', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('same', a), true);
    assert.equal(await verifyPassword('same', b), true);
  });

  it('handles unicode passwords', async () => {
    const hash = await hashPassword('pässwörd-密码-🔑');
    assert.equal(await verifyPassword('pässwörd-密码-🔑', hash), true);
    assert.equal(await verifyPassword('passwoerd', hash), false);
  });

  it('returns false for malformed or foreign stored values instead of throwing', async () => {
    for (const stored of ['', 'plaintext', 'bcrypt$1$2$3$a$b', 'scrypt$1$2$3$onlysalt', 'scrypt$$$$$']) {
      assert.equal(await verifyPassword('x', stored), false, stored);
    }
  });
});
