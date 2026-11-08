/**
 * Paystack's fee on a local (Nigerian) payment by any channel, card or bank transfer, 1.5% + ₦100 capped at ₦2,000 per its published pricing, which the customer pays on top of the order total. It is only an
 * estimate for the checkout summary: Paystack works out the real fee when the card is charged, and the settlement
 * check ignores it (it compares the amount we requested).
 */
const CARD_RATE = 0.015;
const CARD_FLAT_MINOR = 10_000; // ₦100, waived for orders under ₦2,500
const CARD_FLAT_WAIVED_BELOW_MINOR = 250_000;
const CARD_CAP_MINOR = 200_000; // ₦2,000

export function estimatePaymentFee(amountMinor: number, method: 'card' | 'bank_transfer' | undefined): number {
  if (!method || amountMinor <= 0) return 0;
  const flat = amountMinor < CARD_FLAT_WAIVED_BELOW_MINOR ? 0 : CARD_FLAT_MINOR;
  // Paystack's own formula for passing fees to customers: over the cap the customer pays the cap, otherwise the price is
  // grossed up so the merchant still keeps the full amount (plus one kobo, as Paystack adds).
  if (amountMinor * CARD_RATE + flat > CARD_CAP_MINOR) return CARD_CAP_MINOR;
  return Math.ceil((amountMinor + flat) / (1 - CARD_RATE) + 1 - amountMinor);
}
