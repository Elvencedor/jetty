import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.js';
import { unprocessable } from '../../lib/errors.js';
import { deliveryOptions, resolveZone, type DeliveryMethod, type DeliveryOption, type DeliveryZone, type Destination } from '../delivery/zones.js';
import { priceCart, type CartItem, type PricedCart } from './cart.js';

export const QUOTE_TTL_MS = 15 * 60 * 1000;

type Common = { items: CartItem[]; promotionCodes: string[]; customerId?: string | undefined; now?: Date };

async function requireZone(db: Db, destination: Destination): Promise<DeliveryZone> {
  const zone = await resolveZone(db, destination);
  if (!zone) throw unprocessable('DELIVERY_UNAVAILABLE', 'We do not deliver to this location yet.');
  return zone;
}

const feeFor = (option: DeliveryOption, cart: PricedCart) => (cart.freeDelivery ? 0 : option.baseFeeMinor);

/** POST /pricing/quote: stateless, server-calculated totals. Never mutates stock or promotion usage. */
export async function quote(db: Db, input: Common & { deliveryAddress?: Destination; deliveryMethod?: DeliveryMethod }) {
  const now = input.now ?? new Date();

  let zone: DeliveryZone | undefined;
  let option: DeliveryOption | undefined;
  if (input.deliveryAddress && input.deliveryMethod) {
    zone = await requireZone(db, input.deliveryAddress);
    option = deliveryOptions(zone, now).find((o) => o.method === input.deliveryMethod);
    if (!option || !option.available) {
      throw unprocessable('DELIVERY_METHOD_UNAVAILABLE', 'That delivery method is not available for this location right now.', [
        { method: input.deliveryMethod, reason: option?.reason ?? 'NOT_OFFERED' },
      ]);
    }
  }

  const cart = await priceCart(db, { items: input.items, promotionCodes: input.promotionCodes, zoneId: zone?.id, customerId: input.customerId, now });
  const deliveryFeeMinor = option ? feeFor(option, cart) : 0;
  const taxMinor = 0; // Tax/VAT settings are P1 (SET-06).

  return {
    currency: cart.currency,
    lines: cart.lines,
    promotions: cart.promotions,
    warnings: cart.warnings,
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
    totalMinor: cart.subtotalMinor - cart.discountMinor + deliveryFeeMinor + taxMinor,
    // Display-only: checkout recomputes everything and never accepts this id as a price lock.
    quoteId: randomUUID(),
    quoteExpiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
  };
}

/** POST /delivery/quotes: zone, methods, prices, ETAs and same-day eligibility for a destination and cart. */
export async function deliveryQuote(db: Db, input: Common & { deliveryAddress: Destination }) {
  const now = input.now ?? new Date();
  const zone = await requireZone(db, input.deliveryAddress);
  const cart = await priceCart(db, { items: input.items, promotionCodes: input.promotionCodes, zoneId: zone.id, customerId: input.customerId, now });

  return {
    currency: cart.currency,
    zone: { id: zone.id, name: zone.name, state: zone.state },
    options: deliveryOptions(zone, now).map((o) => ({
      method: o.method,
      available: o.available,
      ...(o.reason ? { reason: o.reason } : {}),
      baseFeeMinor: o.baseFeeMinor,
      feeMinor: feeFor(o, cart),
      freeDeliveryPromotionId: cart.freeDelivery?.promotionId ?? null,
      estimate: o.estimate,
    })),
    warnings: cart.warnings,
  };
}
