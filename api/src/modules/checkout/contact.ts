import { sha256 } from '../../lib/tokens.js';

/**
 * Paystack requires an email per transaction, but customers are identified by
 * phone and email is optional. Without one, a stable per-phone address on a
 * mailbox-less domain is used for the provider only; it is never shown to the
 * customer or stored on the order. The phone is hashed, so it is not disclosed.
 */
export const paymentEmail = (email: string | null | undefined, phoneE164: string, placeholderDomain: string) =>
  email ?? `phone-${sha256(phoneE164).slice(0, 20)}@${placeholderDomain}`;
