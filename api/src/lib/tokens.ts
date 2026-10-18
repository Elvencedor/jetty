import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const b64 = (input: string | Buffer) => Buffer.from(input).toString('base64url');

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** Keyed hash for low-entropy secrets (6-digit codes), so a database leak alone cannot be brute-forced offline. */
export const hmacSha256 = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest('hex');
export const newOpaqueSecret = () => randomBytes(32).toString('base64url');

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type AccessClaims = { sub: string; sid: string; exp: number };

const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/** Compact HS256 token. The algorithm is fixed, so a forged `alg` header is never honoured. */
export function signAccessToken(claims: AccessClaims, secret: string): string {
  const body = `${HEADER}.${b64(JSON.stringify(claims))}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verifyAccessToken(token: string, secret: string, now: Date = new Date()): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!sameHash(expected, parts[2]!)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as Partial<AccessClaims>;
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 <= now.getTime()) return null;
    return { sub: claims.sub, sid: claims.sid, exp: claims.exp };
  } catch {
    return null;
  }
}
