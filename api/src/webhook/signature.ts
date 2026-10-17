import { createHmac, timingSafeEqual } from 'node:crypto';

/** Paystack signs the raw request body with HMAC-SHA512 and sends it hex-encoded in x-paystack-signature. */
export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
