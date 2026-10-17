import { paymentEmail } from './contact.js';
import { acquirePromotionHolds } from '../promotions/holds.js';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  orderItems,
  orderPromotionCodes,
  orders,
  orderStatusEvents,
  paymentAttempts,
  productVariants,
  products,
  promotionCodes,
} from '../../db/schema/index.js';
import { conflict, unprocessable } from '../../lib/errors.js';
import { deliveryOptions, resolveZone, type DeliveryMethod } from '../delivery/zones.js';
import { InsufficientStockError, reserveStockInTx } from '../inventory/reservations.js';
import { priceCart, type CartItem } from '../pricing/cart.js';
import { normaliseCode } from '../pricing/load-promotions.js';
import { PaymentIndeterminateError, PaymentRejectedError, type InitializeResult, type PaymentProvider } from '../payments/provider.js';
import type { AppliedPromotionSnapshot } from '../payments/settle.js';

/** How long unpaid stock is held while the buyer pays. */
export const RESERVATION_TTL_MS = 30 * 60 * 1000;
export const GUEST_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

export type DeliveryAddress = {
  recipientName: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  area?: string | undefined;
  city: string;
  state: string;
  countryCode: string;
  landmark?: string | undefined;
  riderNote?: string | undefined;
};

export type CheckoutInput = {
  items: CartItem[];
  promotionCodes: string[];
  contact: { phone: string; email?: string | undefined };
  deliveryAddress: DeliveryAddress;
  deliveryMethod: DeliveryMethod;
  paymentMethod: 'card';
};

export type CheckoutResult =
  | { status: 201; body: Record<string, unknown>; guestToken: string | null }
  | { status: 502; error: { code: string; message: string; details: unknown[] }; guestToken: string | null };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const hashCheckoutToken = hashToken;

const lagosDate = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(now).replaceAll('-', '');

/** JH-YYYYMMDD-NNNN, sequential per Lagos day. Serialised by an advisory lock held until the order commits. */
async function nextOrderNumber(tx: Parameters<Parameters<Db['transaction']>[0]>[0], now: Date): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jetty.order_number'))`);
  const prefix = `JH-${lagosDate(now)}-`;
  const [row] = await tx
    .select({ last: sql<string | null>`max(${orders.orderNumber})` })
    .from(orders)
    .where(like(orders.orderNumber, `${prefix}%`));
  const next = row?.last ? Number(row.last.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

const channelsFor = (method: CheckoutInput['paymentMethod']) => (method === 'card' ? ['card'] : []);

/**
 * Recalculates the cart from PostgreSQL, then atomically creates the
 * pending_payment order snapshot, stock reservations and an initializing
 * payment attempt, and only then calls the provider. Nothing the client sends
 * (prices, totals, references) is trusted.
 *
 * Limited promotions get a first-come-first-served hold here; redemptions are
 * recorded when payment is verified.
 */
export async function checkout(
  db: Db,
  provider: PaymentProvider,
  input: CheckoutInput,
  options: { callbackUrl?: string | undefined; emailDomain: string; customerId?: string | undefined; now?: Date },
): Promise<CheckoutResult> {
  const now = options.now ?? new Date();

  const zone = await resolveZone(db, input.deliveryAddress);
  if (!zone) throw unprocessable('DELIVERY_UNAVAILABLE', 'We do not deliver to this location yet.');
  const option = deliveryOptions(zone, now).find((o) => o.method === input.deliveryMethod);
  if (!option || !option.available) {
    throw unprocessable('DELIVERY_METHOD_UNAVAILABLE', 'That delivery method is not available for this location right now.', [
      { method: input.deliveryMethod, reason: option?.reason ?? 'NOT_OFFERED' },
    ]);
  }

  const cart = await priceCart(db, {
    items: input.items,
    promotionCodes: input.promotionCodes,
    zoneId: zone.id,
    customerId: options.customerId,
    now,
  });
  const deliveryFeeMinor = cart.freeDelivery ? 0 : option.baseFeeMinor;
  const taxMinor = 0;
  const totalMinor = cart.subtotalMinor - cart.discountMinor + deliveryFeeMinor + taxMinor;
  if (totalMinor <= 0) throw unprocessable('ORDER_TOTAL_INVALID', 'The order total must be greater than zero.');

  const snapshots = await db
    .select({
      variantId: productVariants.id,
      productId: productVariants.productId,
      sku: productVariants.sku,
      title: products.title,
      options: productVariants.optionSignature,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, cart.lines.map((l) => l.variantId)));
  const snapshotById = new Map(snapshots.map((s) => [s.variantId, s]));

  const appliedCodes = [...new Set(cart.promotions.applied.map((a) => a.code).filter((c): c is string => Boolean(c)).map(normaliseCode))];
  const codeRows = appliedCodes.length
    ? await db.select({ id: promotionCodes.id, code: promotionCodes.code }).from(promotionCodes).where(inArray(promotionCodes.code, appliedCodes))
    : [];
  const codeIdByCode = new Map(codeRows.map((c) => [c.code, c.id]));
  const appliedPromotions: AppliedPromotionSnapshot[] = cart.promotions.applied.map((a) => ({
    promotionId: a.promotionId,
    promotionCodeId: a.code ? (codeIdByCode.get(normaliseCode(a.code)) ?? null) : null,
    code: a.code,
    discountMinor: a.discountMinor,
  }));

  const guestToken = options.customerId ? null : randomBytes(32).toString('base64url');
  const reference = newPaymentReference();
  const reservationExpiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
  const email = input.contact.email?.trim().toLowerCase() || null;

  let created: { orderId: string; orderNumber: string; attemptId: string };
  try {
    created = await db.transaction(async (tx) => {
      const orderNumber = await nextOrderNumber(tx, now);
      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber,
          customerId: options.customerId ?? null,
          guestCheckoutTokenHash: guestToken ? hashToken(guestToken) : null,
          guestCheckoutTokenExpiresAt: guestToken ? new Date(now.getTime() + GUEST_TOKEN_TTL_MS) : null,
          email,
          phoneE164: input.contact.phone,
          currency: cart.currency,
          subtotalMinor: cart.subtotalMinor,
          discountMinor: cart.discountMinor,
          deliveryFeeMinor,
          taxMinor,
          totalMinor,
          deliveryAddressSnapshot: { ...input.deliveryAddress, zoneId: zone.id, zoneName: zone.name },
          deliveryMethod: input.deliveryMethod,
          appliedPromotions,
          termsAcceptedAt: now,
          reservationExpiresAt,
        })
        .returning({ id: orders.id });
      const orderId = order!.id;

      await tx.insert(orderItems).values(
        cart.lines.map((l) => {
          const snap = snapshotById.get(l.variantId)!;
          return {
            orderId,
            productId: snap.productId,
            variantId: l.variantId,
            skuSnapshot: snap.sku,
            titleSnapshot: snap.title,
            optionsSnapshot: snap.options,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
            discountMinor: l.discountMinor,
            lineTotalMinor: l.lineTotalMinor,
          };
        }),
      );

      await acquirePromotionHolds(tx, {
        orderId,
        customerId: options.customerId ?? null,
        applied: appliedPromotions.map((a) => ({ promotionId: a.promotionId, promotionCodeId: a.promotionCodeId, code: a.code })),
      });

      await reserveStockInTx(tx, { orderId, lines: cart.lines, expiresAt: reservationExpiresAt });

      // Links the submitted codes only; usage is claimed when payment is confirmed.
      if (codeRows.length > 0) await tx.insert(orderPromotionCodes).values(codeRows.map((c) => ({ orderId, promotionCodeId: c.id })));

      const [attempt] = await tx
        .insert(paymentAttempts)
        .values({
          orderId,
          provider: provider.name,
          providerReference: reference,
          method: input.paymentMethod,
          amountMinor: totalMinor,
          currency: cart.currency,
        })
        .returning({ id: paymentAttempts.id });

      await tx.insert(orderStatusEvents).values({
        orderId,
        fromStatus: null,
        toStatus: 'pending_payment',
        actorType: options.customerId ? 'customer' : 'guest',
        actorId: options.customerId ?? null,
      });

      return { orderId, orderNumber, attemptId: attempt!.id };
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      throw conflict('OUT_OF_STOCK', 'One or more items are no longer available in the requested quantity.', [
        { variantId: err.variantId },
      ]);
    }
    throw err;
  }

  const started = await initializeAttempt(db, provider, {
    orderId: created.orderId,
    orderNumber: created.orderNumber,
    attemptId: created.attemptId,
    reference,
    email: paymentEmail(email, input.contact.phone, options.emailDomain),
    amountMinor: totalMinor,
    currency: cart.currency,
    method: input.paymentMethod,
    callbackUrl: options.callbackUrl,
  });
  if (!started.ok) return { status: 502, error: started.error, guestToken };

  return {
    status: 201,
    guestToken,
    body: {
      ...paymentResponse(provider.name, created, started.init, totalMinor, cart.currency, reservationExpiresAt),
      quote: {
        lines: cart.lines,
        promotions: cart.promotions,
        subtotalMinor: cart.subtotalMinor,
        discountMinor: cart.discountMinor,
        deliveryFeeMinor,
        taxMinor,
        totalMinor,
      },
    },
  };
}

export type PaymentAttemptRequest = {
  orderId: string;
  orderNumber: string;
  attemptId: string;
  reference: string;
  email: string;
  amountMinor: number;
  currency: string;
  method: CheckoutInput['paymentMethod'];
  callbackUrl?: string | undefined;
};

export type AttemptStart =
  | { ok: true; init: InitializeResult }
  | { ok: false; error: { code: string; message: string; details: unknown[] } };

/**
 * Calls the provider for an already-persisted attempt (reference and amount are
 * stored first) and records the outcome. A definitive refusal fails the attempt;
 * an unknown outcome leaves it `initializing` so it is reconciled by reference
 * before another attempt is allowed.
 */
export async function initializeAttempt(db: Db, provider: PaymentProvider, a: PaymentAttemptRequest): Promise<AttemptStart> {
  const details = [{ orderId: a.orderId, orderNumber: a.orderNumber }];
  try {
    const init = await provider.initialize({
      email: a.email,
      amountMinor: a.amountMinor,
      currency: a.currency,
      reference: a.reference,
      callbackUrl: a.callbackUrl,
      channels: channelsFor(a.method),
      metadata: { orderId: a.orderId, paymentAttemptId: a.attemptId },
    });
    await db
      .update(paymentAttempts)
      .set({ status: 'pending', initializedAt: new Date() })
      .where(and(eq(paymentAttempts.id, a.attemptId), eq(paymentAttempts.status, 'initializing')));
    return { ok: true, init };
  } catch (err) {
    if (err instanceof PaymentRejectedError) {
      await db
        .update(paymentAttempts)
        .set({ status: 'failed' })
        .where(and(eq(paymentAttempts.id, a.attemptId), eq(paymentAttempts.status, 'initializing')));
      return { ok: false, error: { code: 'PAYMENT_INITIALIZATION_FAILED', message: 'Payment could not be started. You can retry for this order.', details } };
    }
    if (err instanceof PaymentIndeterminateError) {
      return { ok: false, error: { code: 'PAYMENT_INITIALIZATION_PENDING', message: 'Payment start is being confirmed. Check the order status shortly.', details } };
    }
    throw err;
  }
}

export const newPaymentReference = () => `jh_${randomBytes(18).toString('base64url')}`;

export const paymentResponse = (
  providerName: string,
  order: { orderId: string; orderNumber: string; attemptId: string },
  init: InitializeResult,
  amountMinor: number,
  currency: string,
  reservationExpiresAt: Date,
) => ({
  orderId: order.orderId,
  orderNumber: order.orderNumber,
  paymentAttemptId: order.attemptId,
  provider: providerName,
  reference: init.reference,
  accessCode: init.accessCode,
  authorizationUrl: init.authorizationUrl,
  amountMinor,
  currency,
  reservationExpiresAt: reservationExpiresAt.toISOString(),
});
