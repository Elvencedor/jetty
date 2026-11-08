import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OTP_TTL_MINUTES, SECRET_EVENT_TYPES, opsMessage, render } from './templates.js';

describe('render', () => {
  it('confirms a placed order by SMS and email', () => {
    const sms = render('order.placed', 'sms', '+2348012345678', { orderNumber: 'JH-1001' })!;
    assert.equal(sms.to, '+2348012345678');
    assert.match(sms.text, /JH-1001.*confirmed/);
    assert.equal(sms.subject, undefined);
    const email = render('order.placed', 'email', 'a@b.com', { orderNumber: 'JH-1001' })!;
    assert.equal(email.subject, 'Order JH-1001 confirmed');
    assert.match(email.text, /JH-1001/);
  });

  it('words fulfilment updates for delivery vs pickup', () => {
    const packed = (m: string) => render('order.packed', 'sms', 'x', { orderNumber: 'N1', deliveryMethod: m })!.text;
    assert.match(packed('pickup'), /ready for you to collect/);
    assert.match(packed('delivery'), /on its way/);
    assert.match(render('order.out_for_delivery', 'sms', 'x', { orderNumber: 'N1' })!.text, /out for delivery/);
    assert.match(render('order.delivered', 'sms', 'x', { orderNumber: 'N1' })!.text, /delivered/);
    assert.match(render('order.delivered', 'sms', 'x', { orderNumber: 'N1', deliveryMethod: 'pickup' })!.text, /collected/);
  });

  it('uses the right email subject per fulfilment event', () => {
    const subject = (e: string, m?: string) => render(e, 'email', 'a@b.com', { orderNumber: 'N1', deliveryMethod: m })!.subject;
    assert.equal(subject('order.packed'), 'Order N1 packed');
    assert.equal(subject('order.out_for_delivery'), 'Order N1 out for delivery');
    assert.equal(subject('order.delivered'), 'Order N1 delivered');
    assert.equal(subject('order.delivered', 'pickup'), 'Order N1 collected');
  });

  it('mentions the refund on a cancellation only when one is due', () => {
    assert.match(render('order.cancelled', 'sms', 'x', { orderNumber: 'N1', refundDue: true })!.text, /refunded/);
    assert.doesNotMatch(render('order.cancelled', 'sms', 'x', { orderNumber: 'N1', refundDue: false })!.text, /refund/);
    assert.doesNotMatch(render('order.cancelled', 'sms', 'x', { orderNumber: 'N1', refundDue: 'true' })!.text, /refund/);
    assert.equal(render('order.cancelled', 'email', 'a@b.com', { orderNumber: 'N1' })!.subject, 'Order N1 cancelled');
  });

  it('states the refund amount', () => {
    const m = render('order.refunded', 'email', 'a@b.com', { orderNumber: 'N1', amount: '25,000.00' })!;
    assert.match(m.text, /₦25,000\.00/);
    assert.equal(m.subject, 'Refund started for order N1');
  });

  it('sends the password reset code with its lifetime', () => {
    const sms = render('auth.password_reset', 'sms', '+234', { code: '123456' })!;
    assert.match(sms.text, /123456/);
    assert.match(sms.text, new RegExp(`${OTP_TTL_MINUTES} minutes`));
    assert.match(render('auth.password_reset', 'email', 'a@b.com', { code: '123456' })!.subject!, /password reset/);
  });

  it('returns null when required payload fields are missing or mistyped', () => {
    assert.equal(render('order.placed', 'sms', 'x', {}), null);
    assert.equal(render('order.packed', 'sms', 'x', { orderNumber: 5 }), null);
    assert.equal(render('order.refunded', 'sms', 'x', { orderNumber: 'N1' }), null);
    assert.equal(render('order.refunded', 'sms', 'x', { orderNumber: 'N1', amount: 100 }), null);
    assert.equal(render('auth.password_reset', 'sms', 'x', { code: 123456 }), null);
  });

  it('returns null for unknown events', () => {
    assert.equal(render('order.teleported', 'sms', 'x', { orderNumber: 'N1' }), null);
  });

  it('marks password resets as carrying a secret', () => {
    assert.ok(SECRET_EVENT_TYPES.includes('auth.password_reset'));
    assert.ok(!SECRET_EVENT_TYPES.includes('order.placed'));
  });
});

describe('opsMessage', () => {
  it('lists low-stock items and pluralises', () => {
    const m = opsMessage('stock.low', { total: 2, items: [{ sku: 'W1', title: 'Wig', available: 1, threshold: 5 }, { sku: 'W2', title: 'Bundle', available: 0, threshold: 3 }] });
    assert.equal(m.subject, 'Low stock: 2 items need restocking');
    assert.match(m.text, /- Wig \(W1\): 1 left, warn at 5/);
    assert.match(m.text, /- Bundle \(W2\): 0 left, warn at 3/);
    assert.doesNotMatch(m.text, /more\./);
  });
  it('uses the singular for one item', () => {
    const m = opsMessage('stock.low', { total: 1, items: [{ sku: 'W1', title: 'Wig', available: 1, threshold: 5 }] });
    assert.equal(m.subject, 'Low stock: 1 item needs restocking');
    assert.match(m.text, /^1 item is at or under/);
  });
  it('says how many more there are when the list is truncated', () => {
    const m = opsMessage('stock.low', { total: 30, items: [{ sku: 'A', title: 'T', available: 0, threshold: 1 }] });
    assert.match(m.text, /…and 29 more\./);
  });
  it('copes with empty, partial or missing items', () => {
    assert.equal(opsMessage('stock.low', {}).subject, 'Low stock: 0 items need restocking');
    assert.match(opsMessage('stock.low', { items: [{}] }).text, /- Product \(no SKU\): 0 left, warn at 0/);
  });
  it('describes payment exceptions with the reason and order', () => {
    const m = opsMessage('payment.duplicate', { orderNumber: 'N9', reason: 'Duplicate charge' });
    assert.equal(m.subject, 'Payment needs attention: Duplicate charge (N9)');
    assert.match(m.text, /order N9/);
  });
  it('falls back to the event type and "unknown order"', () => {
    const m = opsMessage('payment.late', {});
    assert.equal(m.subject, 'Payment needs attention: payment.late (unknown order)');
  });
});
