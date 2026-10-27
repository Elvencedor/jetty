import { normaliseNigerianPhone } from "@/lib/format";

/** Mirrors the API: passwords are 10–128 characters; codes are six digits. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const CODE_LENGTH = 6;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const passwordError = (value: string): string | undefined =>
  value.length < PASSWORD_MIN ? `Use at least ${PASSWORD_MIN} characters` : value.length > PASSWORD_MAX ? `Use at most ${PASSWORD_MAX} characters` : undefined;

export const phoneError = (value: string): string | undefined => (normaliseNigerianPhone(value) ? undefined : "Enter a Nigerian phone number, e.g. 0803 123 4567");

export const emailError = (value: string): string | undefined => (EMAIL.test(value.trim()) && value.trim().length <= 254 ? undefined : "Enter a valid email");

/** The email as the API wants it (trimmed, lower case). */
export const normaliseEmail = (value: string) => value.trim().toLowerCase();

/** Keeps digits only and caps the length, so pasting "123 456" into a code box works. */
export const cleanCode = (value: string) => value.replace(/\D/g, "").slice(0, CODE_LENGTH);

/**
 * Where to send someone after signing in. Only paths on this site are honoured, so a crafted
 * `?next=https://evil.example` or `?next=//evil.example` can never turn sign-in into an open redirect.
 */
export function safeNext(next: string | null | undefined, fallback = "/account"): string {
  if (!next || next.length > 300) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  if (next.startsWith("/account/sign-in")) return fallback;
  return next;
}
