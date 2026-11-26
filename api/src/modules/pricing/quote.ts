import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.js';
import { unprocessable } from '../../lib/errors.js';
import { deliveryOptions, resolveZone, stateZonesFor, type DeliveryMethod, type DeliveryOption, type DeliveryZone, type Destination } from '../delivery/zones.js';
import { prepForZone, prepForZones } from '../delivery/prep.js';
import { estimatePaymentFee } from '../payments/fees.js';
import { priceCart, type CartItem, type PricedCart } from './cart.js';

export const QUOTE_TTL_MS = 15 * 60 * 1000;

type PaymentMethod = 'card' | 'bank_transfer';
type Common = { items: CartItem[]; promotionCodes: string[]; customerId?: string | undefined; now?: Date };

async function requireZone(db: Db, destination: Destination): Promise<DeliveryZone> {
  const zone = await resolveZone(db, destination);
  if (!zone) throw unprocessable('DELIVERY_UNAVAILABLE', 'We do not deliver to this location yet.');
  return zone;
}

const feeFor = (option: DeliveryOption, cart: PricedCart) => (cart.freeDelivery ? 0 : option.baseFeeMinor);

/** POST /pricing/quote: stateless, server-calculated totals. Never mutates stock or promotion usage. */
export async function quote(db: Db, input: Common & { deliveryAddress?: Destination; deliveryMethod?: DeliveryMethod; paymentMethod?: PaymentMethod }) {
  const now = input.now ?? new Date();

  let zone: DeliveryZone | undefined;
  let option: DeliveryOption | undefined;
  if (input.deliveryAddress && input.deliveryMethod) {
    zone = await requireZone(db, input.deliveryAddress);
    option = deliveryOptions(zone, now, await prepForZone(db, now, zone)).find((o) => o.method === input.deliveryMethod);
    if (!option) {
      throw unprocessable('DELIVERY_METHOD_UNAVAILABLE', 'That delivery method is not available for this location right now.', [
        { method: input.deliveryMethod, reason: 'NOT_OFFERED' },
      ]);
    }
  }

  const cart = await priceCart(db, { items: input.items, promotionCodes: input.promotionCodes, zoneId: zone?.id, customerId: input.customerId, now, withGiftOffers: true });
  const deliveryFeeMinor = option ? feeFor(option, cart) : 0;
  const taxMinor = 0; // Tax/VAT settings are P1 (SET-06).
  const totalMinor = cart.subtotalMinor - cart.discountMinor + deliveryFeeMinor + taxMinor;
  const paymentFeeMinor = estimatePaymentFee(totalMinor, input.paymentMethod);

  return {
    currency: cart.currency,
    lines: cart.lines,
    promotions: cart.promotions,
    warnings: cart.warnings,
    giftOffers: cart.giftOffers,
    subtotalMinor: cart.subtotalMinor,
    discountMinor: cart.discountMinor,
    delivery:
      zone && option
        ? {
            method: option.method,
            zoneId: zone.id,
            zoneName: zone.name,
            baseFeeMinor: option.baseFeeMinor,
            feeMinor: deliveryFeeMinor,
            freeDeliveryPromotionId: cart.freeDelivery?.promotionId ?? null,
            estimate: option.estimate,
          }
        : null,
    deliveryFeeMinor,
    taxMinor,
    totalMinor,
    // Estimated card fee the customer pays to Paystack on top of the order total (0 until a payment method is chosen).
    paymentFeeMinor,
    payableMinor: totalMinor + paymentFeeMinor,
    // Display-only: checkout recomputes everything and never accepts this id as a price lock.
    quoteId: randomUUID(),
    quoteExpiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
  };
}

/** POST /delivery/quotes: zone, methods, prices, ETAs for a destination and cart. */
export async function deliveryQuote(db: Db, input: Common & { deliveryAddress: Destination }) {
  const now = input.now ?? new Date();
  const resolved = await resolveZone(db, input.deliveryAddress);
  if (!resolved) {
    // The state is served by several area zones and the customer has not said which area. Show the spread of prices and
    // the areas behind each one instead of claiming we do not deliver.
    const zones = await stateZonesFor(db, input.deliveryAddress.state);
    if (zones.length === 0) throw unprocessable('DELIVERY_UNAVAILABLE', 'We do not deliver to this location yet.');
    const cart = await priceCart(db, { items: input.items, promotionCodes: input.promotionCodes, customerId: input.customerId, now });
    const preps = await prepForZones(db, now, zones);
    // Held back only if every zone is: the earliest start is what a customer in any of them can count on.
    const held = zones.map((z) => preps.get(z.id) ?? null);
    const earliest = held.every((h) => h !== null) ? held.reduce((a, b) => (a!.startsOn <= b!.startsOn ? a : b)) : null;
    const fees = zones.map((z) => Number(z.deliveryFeeMinor));
    return {
      currency: cart.currency,
      zone: null,
      prep: earliest,
      options: [],
      deliveryRange: { minFeeMinor: Math.min(...fees), maxFeeMinor: Math.max(...fees) },
      areaPrices: zones.map((z) => ({
        zoneId: z.id,
        zoneName: z.name,
        areas: Array.isArray(z.areas) ? z.areas.filter((a): a is string => typeof a === 'string') : [],
        feeMinor: Number(z.deliveryFeeMinor),
        startsOn: preps.get(z.id)?.startsOn ?? null,
        minDays: z.deliveryMinDays,
        maxDays: z.deliveryMaxDays,
      })),
      warnings: cart.warnings,
    };
  }
  const zone = resolved;
  const prep = await prepForZone(db, now, zone);
  const cart = await priceCart(db, { items: input.items, promotionCodes: input.promotionCodes, zoneId: zone.id, customerId: input.customerId, now });

  return {
    prep,
    deliveryRange: null,
    areaPrices: [],
    currency: cart.currency,
    zone: { id: zone.id, name: zone.name, scope: zone.scope, state: zone.state },
    options: deliveryOptions(zone, now, prep).map((o) => ({
      method: o.method,
      available: o.available,
      baseFeeMinor: o.baseFeeMinor,
      feeMinor: feeFor(o, cart),
      freeDeliveryPromotionId: cart.freeDelivery?.promotionId ?? null,
      estimate: o.estimate,
    })),
    warnings: cart.warnings,
  };
}
