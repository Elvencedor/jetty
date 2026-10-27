import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { revalidateStorefront } from './revalidate.js';

const log = () => {
  const warnings: string[] = [];
  return { warnings, warn: (msg: string) => void warnings.push(msg) };
};

describe('revalidateStorefront', () => {
  it('does nothing unless the storefront URL and secret are both set', async () => {
    let called = 0;
    const fetchImpl = (async () => (called++, new Response(null, { status: 204 }))) as unknown as typeof fetch;
    await revalidateStorefront({ STOREFRONT_REVALIDATE_URL: undefined, REVALIDATE_SECRET: undefined }, log(), ['settings'], fetchImpl);
    await revalidateStorefront({ STOREFRONT_REVALIDATE_URL: 'https://shop.test/api/revalidate', REVALIDATE_SECRET: undefined }, log(), ['settings'], fetchImpl);
    assert.equal(called, 0);
  });

  it('posts the tags with the shared secret', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response(null, { status: 204 }))) as unknown as typeof fetch;
    await revalidateStorefront({ STOREFRONT_REVALIDATE_URL: 'https://shop.test/api/revalidate', REVALIDATE_SECRET: 'a-long-shared-secret' }, log(), ['settings', 'home'], fetchImpl);
    assert.equal(seen!.url, 'https://shop.test/api/revalidate');
    assert.equal((seen!.init.headers as Record<string, string>)['x-revalidate-secret'], 'a-long-shared-secret');
    assert.deepEqual(JSON.parse(String(seen!.init.body)), { tags: ['settings', 'home'] });
  });

  it('never throws: a refusal or an unreachable storefront is only logged', async () => {
    const env = { STOREFRONT_REVALIDATE_URL: 'https://shop.test/api/revalidate', REVALIDATE_SECRET: 'a-long-shared-secret' };
    const refused = log();
    await revalidateStorefront(env, refused, ['settings'], (async () => new Response(null, { status: 401 })) as unknown as typeof fetch);
    assert.deepEqual(refused.warnings, ['storefront revalidation was refused']);
    const down = log();
    await revalidateStorefront(env, down, ['settings'], (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    assert.deepEqual(down.warnings, ['storefront revalidation failed']);
  });
});
