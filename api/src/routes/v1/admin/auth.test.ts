import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { eq } from 'drizzle-orm';
import { adminSessions, adminUsers } from '../../../db/schema/index.js';
import { createLogger } from '../../../lib/logger.js';
import { createServer } from '../../../server.js';
import { ADMIN_PASSWORD, adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';
import { createTestRateLimiter, TEST_REDIS_URL } from '../../../testing/redis.js';

type Json = Record<string, any>;

describe('admin authentication and authorization', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  const post = (url: string, payload: Json, headers: Record<string, string> = {}, server = api) => server.inject({ method: 'POST', url: `/api/v1${url}`, payload, headers });

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
    await api.initialize();
  });
  after(async () => {
    await api?.stop();
    await t?.destroy();
  });

  it('signs in with email and password and sets a rotating HttpOnly refresh cookie', async () => {
    const admin = await signInAdmin(t.db, api);
    const res = await post('/admin/auth/login', { email: admin.email.toUpperCase(), password: ADMIN_PASSWORD });
    assert.equal(res.statusCode, 200);
    assert.equal((res.result as Json).admin.email, admin.email);
    assert.ok((res.result as Json).accessToken);
    assert.equal((res.result as Json).refreshToken, undefined, 'the refresh token only travels in the cookie');
    assert.match(String(res.headers['set-cookie']), /jh_admin_refresh=.*HttpOnly/i);
  });

  it('rejects wrong passwords and unknown emails identically, and disabled admins', async () => {
    const admin = await signInAdmin(t.db, api);
    const wrong = await post('/admin/auth/login', { email: admin.email, password: 'wrong password!!' });
    const unknown = await post('/admin/auth/login', { email: 'nobody@example.com', password: 'wrong password!!' });
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual((wrong.result as Json).error.code, (unknown.result as Json).error.code);
    await t.db.update(adminUsers).set({ status: 'disabled' }).where(eq(adminUsers.id, admin.id));
    assert.equal((await post('/admin/auth/login', { email: admin.email, password: ADMIN_PASSWORD })).statusCode, 401);
    assert.equal((await api.inject({ url: '/api/v1/admin/me', headers: admin.headers })).statusCode, 401, 'existing tokens die with the account');
  });

  it('does not accept a customer token or a tampered token as an admin session', async () => {
    const admin = await signInAdmin(t.db, api);
    const customer = await post('/auth/register', { phone: '+2348099900011', password: 'correct horse battery' });
    for (const token of [(customer.result as Json).accessToken, `${admin.token}x`]) {
      assert.equal((await api.inject({ url: '/api/v1/admin/me', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    }
    assert.equal((await api.inject({ url: '/api/v1/admin/me' })).statusCode, 401);
  });

  it('rotates the refresh cookie, revokes on replay, and logout ends the session', async () => {
    const admin = await signInAdmin(t.db, api);
    const login = await post('/admin/auth/login', { email: admin.email, password: ADMIN_PASSWORD });
    const cookie = /jh_admin_refresh=([^;]+)/.exec(String(login.headers['set-cookie']))![1]!;
    const refreshWith = (c: string) => api.inject({ method: 'POST', url: '/api/v1/admin/auth/refresh', headers: { cookie: `jh_admin_refresh=${c}` } });

    const next = await refreshWith(cookie);
    assert.equal(next.statusCode, 200);
    const nextCookie = /jh_admin_refresh=([^;]+)/.exec(String(next.headers['set-cookie']))![1]!;
    assert.notEqual(nextCookie, cookie);
    assert.equal((await refreshWith(cookie)).statusCode, 401, 'a rotated-out token is refused');
    assert.equal((await refreshWith(nextCookie)).statusCode, 401, 'and replay revokes the whole session');

    const fresh = await signInAdmin(t.db, api);
    assert.equal((await api.inject({ url: '/api/v1/admin/me', headers: fresh.headers })).statusCode, 200);
    assert.equal((await post('/admin/auth/logout', {}, fresh.headers)).statusCode, 204);
    assert.equal((await api.inject({ url: '/api/v1/admin/me', headers: fresh.headers })).statusCode, 401);
    const sessions = await t.db.select().from(adminSessions).where(eq(adminSessions.adminUserId, fresh.id));
    assert.ok(sessions.every((s) => s.revokedAt));
  });

  it('exposes roles and permissions', async () => {
    const support = await signInAdmin(t.db, api, 'support');
    const me = (await api.inject({ url: '/api/v1/admin/me', headers: support.headers })).result as Json;
    assert.deepEqual(me.roles, ['support']);
    assert.ok(me.permissions.includes('reviews:moderate'));
  });

  it('every admin route except sign-in and refresh requires an admin session and a declared permission', () => {
    const open = new Set(['/api/v1/admin/auth/login', '/api/v1/admin/auth/refresh']);
    const adminRoutes = api.table().filter((r) => r.path.startsWith('/api/v1/admin/'));
    assert.ok(adminRoutes.length > 40);
    for (const r of adminRoutes) {
      if (open.has(r.path)) continue;
      const auth = r.settings.auth as { strategies?: string[]; mode?: string } | false;
      assert.deepEqual(auth && auth.strategies, ['admin'], `${r.method} ${r.path} must use admin auth`);
      assert.equal(auth && auth.mode, 'required', `${r.method} ${r.path}`);
      assert.ok(Array.isArray(r.settings.plugins?.permission) && r.settings.plugins.permission.length > 0, `${r.method} ${r.path} must declare a permission`);
    }
  });

  describe('throttling', { skip: !TEST_REDIS_URL && 'TEST_REDIS_URL not set' }, () => {
    it('cannot be used to lock the real admin out from another address, and fails closed if the limiter is down', async () => {
      const admin = await signInAdmin(t.db, api);
      const limiter = await createTestRateLimiter();
      const server = await createServer({ env: adminTestEnv({ RATE_LIMIT_ENABLED: 'true', REDIS_URL: TEST_REDIS_URL!, TRUSTED_PROXY_HOPS: '1' }), logger: createLogger('error'), database: t, rateLimiter: limiter });
      await server.initialize();
      const from = (ip: string, password: string) => post('/admin/auth/login', { email: admin.email, password }, { 'x-forwarded-for': ip }, server);

      for (let i = 0; i < 8; i++) assert.equal((await from('198.51.100.7', 'wrong wrong wrong')).statusCode, 401);
      assert.equal((await from('198.51.100.7', 'wrong wrong wrong')).statusCode, 429, 'the attacker is throttled');
      assert.equal((await from('203.0.113.9', ADMIN_PASSWORD)).statusCode, 200, 'the real admin, elsewhere, is not');
      await server.stop();
      await limiter.close();

      const broken = { consume: async () => { throw new Error('redis down'); }, reset: async () => undefined, close: async () => undefined };
      const down = await createServer({ env: adminTestEnv({ RATE_LIMIT_ENABLED: 'true', REDIS_URL: TEST_REDIS_URL! }), logger: createLogger('error'), database: t, rateLimiter: broken });
      await down.initialize();
      const res = await post('/admin/auth/login', { email: admin.email, password: ADMIN_PASSWORD }, {}, down);
      assert.equal(res.statusCode, 503, 'no limiter, no password guessing');
      await down.stop();
    });
  });
});
