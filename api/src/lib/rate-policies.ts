import type { Policy } from './rate-limit.js';

const minutes = (n: number) => n * 60 * 1000;
const policy = (name: string, limit: number, windowMs: number): Policy => ({ name, limit, windowMs });

/** Per-IP limits sit in front of expensive work; per-account limits stop credential and enumeration guessing across IPs. */
export const LIMITS = {
  register: policy('register:ip', 10, minutes(60)),
  login: policy('login:ip', 30, minutes(15)),
  loginAccount: policy('login:account', 8, minutes(15)),
  refresh: policy('refresh:ip', 60, minutes(15)),
  track: policy('track:ip', 20, minutes(15)),
  trackOrder: policy('track:order', 10, minutes(60)),
  quote: policy('quote:ip', 60, minutes(1)),
  checkout: policy('checkout:ip', 20, minutes(10)),
  payment: policy('payment:ip', 30, minutes(10)),
  webhook: policy('webhook:ip', 600, minutes(1)),
} as const;
