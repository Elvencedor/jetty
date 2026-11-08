import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeStorage } from '../../testing/fake-storage.js';
import { S3Storage, type S3Options } from './storage.js';
import { withLineImages, withUrl, withUrls } from './urls.js';

const options = (over: Partial<S3Options> = {}): S3Options => ({
  endpoint: 'https://acct.r2.example.com',
  bucket: 'jetty-media',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
  region: 'auto',
  ...over,
});
const NOW = new Date('2026-06-01T10:30:45.123Z');

describe('S3Storage presigned uploads', () => {
  const storage = new S3Storage(options());
  const intent = storage.presignUpload({ key: 'products/p1/a b.jpg', contentType: 'image/jpeg', sizeBytes: 12345, expiresInSeconds: 300, now: NOW });
  const url = new URL(intent.url);

  it('uses path-style addressing on the configured host', () => {
    assert.equal(url.origin, 'https://acct.r2.example.com');
    assert.equal(url.pathname, '/jetty-media/products/p1/a%20b.jpg');
  });

  it('is a SigV4 query signature with the right scope and expiry', () => {
    assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.equal(url.searchParams.get('X-Amz-Credential'), 'AKIDEXAMPLE/20260601/auto/s3/aws4_request');
    assert.equal(url.searchParams.get('X-Amz-Date'), '20260601T103045Z');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
    assert.match(url.searchParams.get('X-Amz-Signature')!, /^[0-9a-f]{64}$/);
  });

  it('tells the browser exactly which headers to send', () => {
    assert.equal(intent.method, 'PUT');
    assert.deepEqual(intent.headers, { 'Content-Length': '12345', 'Content-Type': 'image/jpeg' });
    assert.equal(intent.expiresAt, new Date(NOW.getTime() + 300_000).toISOString());
  });

  it('is deterministic for the same inputs and changes with type, size, key or secret', () => {
    const sig = (s: S3Storage, over: Partial<Parameters<S3Storage['presignUpload']>[0]> = {}) =>
      new URL(s.presignUpload({ key: 'k.jpg', contentType: 'image/jpeg', sizeBytes: 1, expiresInSeconds: 60, now: NOW, ...over }).url).searchParams.get('X-Amz-Signature');
    const base = sig(storage);
    assert.equal(base, sig(storage));
    assert.notEqual(base, sig(storage, { contentType: 'image/png' }));
    assert.notEqual(base, sig(storage, { sizeBytes: 2 }));
    assert.notEqual(base, sig(storage, { key: 'other.jpg' }));
    assert.notEqual(base, sig(new S3Storage(options({ secretAccessKey: 'different' }))));
  });
});

describe('S3Storage read URLs', () => {
  it('builds stable public URLs when a CDN is configured, tolerating trailing slashes', () => {
    const s = new S3Storage(options({ publicBaseUrl: 'https://media.example.com//' }));
    assert.equal(s.urlFor('products/p1/a b.jpg'), 'https://media.example.com/products/p1/a%20b.jpg');
  });

  it('presigns reads for two hours, signed at the top of the hour so the URL is cacheable', () => {
    const s = new S3Storage(options());
    const a = s.urlFor('k.jpg', new Date('2026-06-01T10:01:00Z'));
    const b = s.urlFor('k.jpg', new Date('2026-06-01T10:59:59Z'));
    const c = s.urlFor('k.jpg', new Date('2026-06-01T11:00:00Z'));
    assert.equal(a, b);
    assert.notEqual(a, c);
    const q = new URL(a).searchParams;
    assert.equal(q.get('X-Amz-Date'), '20260601T100000Z');
    assert.equal(q.get('X-Amz-Expires'), '7200');
    assert.equal(q.get('X-Amz-SignedHeaders'), 'host');
  });
});

describe('S3Storage.head', () => {
  const withFetch = (res: Response | Error) => {
    const seen: { url: string; method: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, method: String(init.method) });
      if (res instanceof Error) throw res;
      return res;
    }) as unknown as typeof fetch;
    return { seen, storage: new S3Storage(options({ fetch: fetchImpl })) };
  };

  it('reports size and content type of an existing object', async () => {
    const { storage, seen } = withFetch(new Response(null, { status: 200, headers: { 'content-length': '2048', 'content-type': 'image/png' } }));
    assert.deepEqual(await storage.head('k.png'), { sizeBytes: 2048, contentType: 'image/png' });
    assert.equal(seen[0]!.method, 'HEAD');
    assert.match(seen[0]!.url, /X-Amz-Signature=/);
  });

  it('returns null for a missing object', async () => {
    assert.equal(await withFetch(new Response(null, { status: 404 })).storage.head('nope'), null);
  });

  it('throws on other failures and on network errors', async () => {
    await assert.rejects(withFetch(new Response(null, { status: 403 })).storage.head('k'), /403/);
    await assert.rejects(withFetch(new Error('offline')).storage.head('k'), /offline/);
  });

  it('treats a missing content-length as zero', async () => {
    const { storage } = withFetch(new Response(null, { status: 200 }));
    assert.equal((await storage.head('k'))?.sizeBytes, 0);
  });
});

describe('image URL helpers', () => {
  const storage = new FakeStorage();
  const image = { objectKey: 'products/p/1.jpg', altText: 'front' };

  it('withUrl adds a URL, or null when storage is not configured', () => {
    assert.equal(withUrl(storage, image)?.url, 'https://storage.test/products/p/1.jpg?download=1');
    assert.equal(withUrl(undefined, image)?.url, null);
    assert.equal(withUrl(storage, image)?.altText, 'front');
  });
  it('withUrl passes null and undefined through', () => {
    assert.equal(withUrl(storage, null), null);
    assert.equal(withUrl(storage, undefined), null);
  });
  it('withUrls maps every image and keeps order', () => {
    const out = withUrls(storage, [{ objectKey: 'a' }, { objectKey: 'b' }]);
    assert.deepEqual(out.map((i) => i.objectKey), ['a', 'b']);
    assert.ok(out.every((i) => i.url));
  });
  it('withLineImages decorates cart lines without mutating the input', () => {
    const cart = { currency: 'NGN', lines: [{ id: 1, image: { objectKey: 'a' } }, { id: 2, image: null }] };
    const out = withLineImages(storage, cart);
    assert.ok(out.lines[0]!.image && 'url' in out.lines[0]!.image);
    assert.equal(out.lines[1]!.image, null);
    assert.equal(out.currency, 'NGN');
    assert.equal('url' in cart.lines[0]!.image!, false);
  });
});
