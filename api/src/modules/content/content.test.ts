import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BODY_SCHEMAS, CONTENT_TYPES, SECTION_TYPES, TONES } from './content.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const ok = (type: keyof typeof BODY_SCHEMAS, body: unknown) => BODY_SCHEMAS[type].validate(body).error === undefined;

describe('content body schemas', () => {
  it('has a schema for every content type', () => {
    for (const t of CONTENT_TYPES) assert.ok(BODY_SCHEMAS[t], t);
    assert.deepEqual(Object.keys(BODY_SCHEMAS).sort(), [...CONTENT_TYPES].sort());
  });

  it('announcements need text and may link', () => {
    assert.equal(ok('announcement', { text: 'Free delivery this week' }), true);
    assert.equal(ok('announcement', { text: 'Sale', linkUrl: '/shop', linkLabel: 'Shop' }), true);
    assert.equal(ok('announcement', {}), false);
    assert.equal(ok('announcement', { text: 'x'.repeat(201) }), false);
  });

  it('only allows http(s) URLs and single-slash site paths for links', () => {
    for (const good of ['https://example.com/a?b=1', 'http://example.com', '/shop', '/shop/wigs?x=1', '/']) {
      assert.equal(ok('announcement', { text: 't', linkUrl: good }), true, good);
    }
    for (const bad of ['//evil.com', '/\\evil.com', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://x.com', 'shop', 'https://exa mple.com', '']) {
      assert.equal(ok('announcement', { text: 't', linkUrl: bad }), false, bad);
    }
  });

  it('banners require a headline and a known tone', () => {
    assert.equal(ok('banner', { headline: 'New in' }), true);
    for (const tone of TONES) assert.equal(ok('banner', { headline: 'h', tone }), true, tone);
    assert.equal(ok('banner', { headline: 'h', tone: 'neon' }), false);
    assert.equal(ok('banner', { tag: 'new' }), false);
  });

  it('pages carry markdown up to 100k characters', () => {
    assert.equal(ok('page', { markdown: '# Hi' }), true);
    assert.equal(ok('page', { markdown: 'x'.repeat(100_001) }), false);
    assert.equal(ok('page', {}), false);
  });

  it('featured product lists need unique ids, at most 24', () => {
    assert.equal(ok('featured_products', { productIds: [U1, U2] }), true);
    assert.equal(ok('featured_products', { productIds: [] }), true);
    assert.equal(ok('featured_products', { productIds: [U1, U1] }), false);
    assert.equal(ok('featured_products', { productIds: ['nope'] }), false);
    const many = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    assert.equal(ok('featured_products', { productIds: many }), false);
    assert.equal(ok('featured_products', { productIds: many.slice(0, 24) }), true);
  });

  it('stories and tiles require a title and a link', () => {
    assert.equal(ok('story', { title: 'Wigs', linkUrl: '/shop' }), true);
    assert.equal(ok('story', { title: 'Wigs' }), false);
    assert.equal(ok('story', { title: 'x'.repeat(41), linkUrl: '/shop' }), false);
    assert.equal(ok('tile', { title: 'Closure', linkUrl: '/shop?type=closure', tone: 'plum' }), true);
    assert.equal(ok('tile', { linkUrl: '/shop' }), false);
  });

  it('flash sales point at a promotion', () => {
    assert.equal(ok('flash', { promotionId: U1, headline: 'Flash!' }), true);
    assert.equal(ok('flash', { promotionId: 'x' }), false);
    assert.equal(ok('flash', {}), false);
  });

  it('home layouts list known sections once each', () => {
    assert.equal(ok('home_layout', { sections: [{ type: 'hero' }, { type: 'products', enabled: false }] }), true);
    assert.equal(ok('home_layout', { sections: [] }), true);
    assert.equal(ok('home_layout', { sections: [{ type: 'hero' }, { type: 'hero' }] }), false);
    assert.equal(ok('home_layout', { sections: [{ type: 'carousel' }] }), false);
    assert.equal(ok('home_layout', {}), false);
  });

  it('defaults a section to enabled', () => {
    const { value } = BODY_SCHEMAS.home_layout.validate({ sections: [{ type: 'hero' }] });
    assert.equal(value.sections[0].enabled, true);
  });

  it('exposes the nine home sections', () => {
    assert.equal(SECTION_TYPES.length, 9);
  });

  it('rejects unknown fields, so body JSON stays within the documented shape', () => {
    assert.equal(ok('banner', { headline: 'h', html: '<script>' }), false);
    assert.equal(ok('page', { markdown: 'x', extra: 1 }), false);
  });
});
