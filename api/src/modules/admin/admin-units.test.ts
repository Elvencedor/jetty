import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createContentUploadIntent, CONTENT_KEY_PREFIX, keyPrefix, MAX_UPLOAD_BYTES, MEDIA_TYPES, UPLOAD_TTL_SECONDS } from './media.js';
import { permits } from './auth.js';
import { allowedNext } from './orders.js';
import { normaliseTags, slugify } from './products.js';
import { CODE_PATTERN, SUPPORTED_KINDS } from './promotions.js';
import { SEGMENTS } from './people.js';
import { zoneSchema } from './zones.js';
import { STOCK_REASONS } from './inventory.js';
import { FakeStorage } from '../../testing/fake-storage.js';

describe('permits', () => {
  it('lets the wildcard through everything', () => {
    assert.equal(permits(['*'], 'orders:write'), true);
    assert.equal(permits(['*'], 'anything'), true);
  });
  it('matches exact permissions', () => {
    assert.equal(permits(['orders:read'], 'orders:read'), true);
    assert.equal(permits(['orders:read'], 'products:read'), false);
  });
  it('lets write imply read of the same area, but never the reverse', () => {
    assert.equal(permits(['products:write'], 'products:read'), true);
    assert.equal(permits(['products:read'], 'products:write'), false);
    assert.equal(permits(['orders:write'], 'products:read'), false);
  });
  it('grants nothing without permissions', () => {
    assert.equal(permits([], 'orders:read'), false);
  });
  it('does not treat prefixes as matches', () => {
    assert.equal(permits(['order:write'], 'orders:read'), false);
  });
});

describe('order fulfilment transitions', () => {
  it('steps forward one state at a time for delivery orders', () => {
    assert.deepEqual(allowedNext('placed', 'delivery'), ['packed']);
    assert.deepEqual(allowedNext('packed', 'delivery'), ['out_for_delivery']);
    assert.deepEqual(allowedNext('out_for_delivery', 'delivery'), ['delivered']);
  });
  it('skips dispatch for pickup: packed goes straight to collected', () => {
    assert.deepEqual(allowedNext('placed', 'pickup'), ['packed']);
    assert.deepEqual(allowedNext('packed', 'pickup'), ['delivered']);
  });
  it('offers nothing from terminal or unpaid states', () => {
    for (const s of ['delivered', 'cancelled', 'pending_payment', 'refunded'] as const) {
      assert.deepEqual(allowedNext(s as never, 'delivery'), [], s);
    }
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    assert.equal(slugify('HD Lace Closure Wig'), 'hd-lace-closure-wig');
  });
  it('strips accents and punctuation', () => {
    assert.equal(slugify('Crème Brûlée — 100% Human!'), 'creme-brulee-100-human');
  });
  it('trims stray separators and collapses runs', () => {
    assert.equal(slugify('  --Hello   World--  '), 'hello-world');
  });
  it('falls back to "product" when nothing usable remains', () => {
    assert.equal(slugify('!!!'), 'product');
    assert.equal(slugify('密码'), 'product');
    assert.equal(slugify(''), 'product');
  });
  it('caps the length at 120', () => {
    assert.equal(slugify('a'.repeat(300)).length, 120);
  });
});

describe('normaliseTags', () => {
  it('lowercases, trims, collapses spaces, drops blanks and duplicates', () => {
    assert.deepEqual(normaliseTags(['Best Seller ', 'best   seller', '', '  ', 'New']), ['best seller', 'new']);
  });
  it('keeps first-seen order', () => {
    assert.deepEqual(normaliseTags(['b', 'a', 'B']), ['b', 'a']);
  });
  it('handles an empty list', () => {
    assert.deepEqual(normaliseTags([]), []);
  });
});

describe('promotion constants', () => {
  it('supports the five promotion kinds', () => {
    assert.deepEqual([...SUPPORTED_KINDS], ['percentage', 'fixed_amount', 'buy_x_get_y', 'free_delivery', 'free_gift']);
  });
  it('accepts 3-32 character codes of letters, digits, _ and -', () => {
    for (const good of ['SAVE10', 'save-10', 'A_B', '0FF', 'x'.repeat(32)]) assert.match(good, CODE_PATTERN);
    for (const bad of ['AB', 'x'.repeat(33), '-SAVE', '_SAVE', 'SA VE', 'SAVE!', '']) assert.doesNotMatch(bad, CODE_PATTERN);
  });
});

describe('customer segments', () => {
  it('describes the four segments to staff', () => {
    assert.deepEqual(SEGMENTS.map((s) => s.key), ['vip', 'new', 'returning', 'lapsed']);
    assert.ok(SEGMENTS.every((s) => s.label && s.rule));
  });
});

describe('stock reasons', () => {
  it('lists the adjustment reasons', () => {
    assert.deepEqual([...STOCK_REASONS], ['restock', 'correction', 'damaged', 'returned', 'stock_count']);
  });
});

describe('delivery zone schema', () => {
  const ok = (v: unknown) => zoneSchema.validate(v).error === undefined;
  it('accepts a full zone', () => {
    assert.equal(ok({ name: 'Lagos Mainland', state: 'Lagos', areas: ['Yaba', 'Surulere'], active: true, timezone: 'Africa/Lagos', deliveryFeeMinor: 300000, deliveryMinDays: 1, deliveryMaxDays: 3, pickupEnabled: true }), true);
  });
  it('no longer takes the retired same-day, next-day, nationwide or cut-off fields', () => {
    for (const field of ['sameDayCutoffLocal', 'sameDayFeeMinor', 'nextDayFeeMinor', 'nationwideFeeMinor']) assert.equal(ok({ [field]: null }), false, field);
  });
  it('delivery time is whole days from 0 to 60', () => {
    for (const good of [0, 1, 60]) assert.equal(ok({ deliveryMinDays: good, deliveryMaxDays: good }), true, String(good));
    for (const bad of [-1, 61, 1.5, '2days']) assert.equal(ok({ deliveryMinDays: bad }), false, String(bad));
  });
  it('covers one state or a list of states', () => {
    assert.equal(ok({ scope: 'state', state: 'Lagos' }), true);
    assert.equal(ok({ scope: 'nationwide', state: null, states: ['Kano', 'Kaduna'] }), true);
    assert.equal(ok({ scope: 'region' }), false);
    assert.equal(ok({ states: ['Kano', 'kano'] }), false, 'no state twice');
  });
  it('only accepts real IANA timezones', () => {
    assert.equal(ok({ timezone: 'Africa/Lagos' }), true);
    assert.equal(ok({ timezone: 'UTC' }), true);
    assert.equal(ok({ timezone: 'Mars/Olympus' }), false);
  });
  it('fees are whole non-negative amounts up to a billion, or null', () => {
    assert.equal(ok({ deliveryFeeMinor: 0 }), true);
    assert.equal(ok({ deliveryFeeMinor: null }), true);
    assert.equal(ok({ deliveryFeeMinor: -1 }), false);
    assert.equal(ok({ deliveryFeeMinor: 1.5 }), false);
    assert.equal(ok({ deliveryFeeMinor: 1_000_000_001 }), false);
  });
  it('areas must be unique ignoring case', () => {
    assert.equal(ok({ areas: ['Yaba', 'yaba'] }), false);
    assert.equal(ok({ areas: ['Yaba', 'Ikeja'] }), true);
    assert.equal(ok({ areas: [''] }), false);
  });
  it('requires a UUID for ids and non-empty names', () => {
    assert.equal(ok({ id: 'not-a-uuid' }), false);
    assert.equal(ok({ name: '' }), false);
  });
});

describe('upload intents', () => {
  it('accepts the four image types and picks the key server-side under the content prefix', () => {
    const storage = new FakeStorage();
    for (const [type, ext] of Object.entries(MEDIA_TYPES)) {
      const { objectKey, upload } = createContentUploadIntent(storage, { contentType: type, sizeBytes: 1000 });
      assert.match(objectKey, new RegExp(`^${CONTENT_KEY_PREFIX}[0-9a-f-]{36}\\.${ext}$`));
      assert.equal(upload.method, 'PUT');
    }
    assert.deepEqual(Object.keys(MEDIA_TYPES), ['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
  });
  it('rejects other types, including SVG and HTML', () => {
    const storage = new FakeStorage();
    for (const contentType of ['image/svg+xml', 'text/html', 'application/pdf', 'image/gif', '']) {
      assert.throws(() => createContentUploadIntent(storage, { contentType, sizeBytes: 10 }), (e: { data: { code: string } }) => e.data.code === 'UNSUPPORTED_MEDIA_TYPE', contentType);
    }
    assert.equal(storage.presigned.length, 0);
  });
  it('rejects files over 10 MB but accepts exactly 10 MB', () => {
    const storage = new FakeStorage();
    assert.doesNotThrow(() => createContentUploadIntent(storage, { contentType: 'image/png', sizeBytes: MAX_UPLOAD_BYTES }));
    assert.throws(() => createContentUploadIntent(storage, { contentType: 'image/png', sizeBytes: MAX_UPLOAD_BYTES + 1 }), (e: { data: { code: string } }) => e.data.code === 'FILE_TOO_LARGE');
  });
  it('gives a different key every time', () => {
    const storage = new FakeStorage();
    const a = createContentUploadIntent(storage, { contentType: 'image/png', sizeBytes: 1 }).objectKey;
    const b = createContentUploadIntent(storage, { contentType: 'image/png', sizeBytes: 1 }).objectKey;
    assert.notEqual(a, b);
  });
  it('scopes product images to the product prefix and signs for five minutes', () => {
    assert.equal(keyPrefix('abc'), 'products/abc/');
    assert.equal(UPLOAD_TTL_SECONDS, 300);
  });
});
