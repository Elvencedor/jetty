import type { Policy } from './rate-limit.js';

const minutes = (n: number) => n * 60 * 1000;
const policy = (name: string, limit: number, windowMs: number): Policy => ({ name, limit, windowMs });

/** Per-IP limits sit in front of expensive work; per-account limits stop credential and enumeration guessing across IPs. */
export const LIMITS = {
  register: policy('register:ip', 10, minutes(60)),
  login: policy('login:ip', 30, minutes(15)),
  loginAccount: policy('login:account', 8, minutes(15)),
  otpRequest: policy('otp-request:ip', 10, minutes(15)),
  otpRequestPhone: policy('otp-request:phone', 5, minutes(60)),
  otpVerify: policy('otp-verify:ip', 30, minutes(15)),
  otpVerifyAccount: policy('otp-verify:account', 10, minutes(15)),
  passwordForgot: policy('password-forgot:ip', 10, minutes(15)),
  passwordForgotAccount: policy('password-forgot:account', 5, minutes(60)),
  passwordReset: policy('password-reset:ip', 20, minutes(15)),
  refresh: policy('refresh:ip', 60, minutes(15)),
  track: policy('track:ip', 20, minutes(15)),
  trackOrder: policy('track:order', 10, minutes(60)),
  quote: policy('quote:ip', 60, minutes(1)),
  checkout: policy('checkout:ip', 20, minutes(10)),
  payment: policy('payment:ip', 30, minutes(10)),
  facets: policy('facets:ip', 120, minutes(1)),
  suggest: policy('suggest:ip', 120, minutes(1)),
  reviewSubmit: policy('review:customer', 10, minutes(60)),
  adminLogin: policy('admin-login:ip', 20, minutes(15)),
  // Keyed by email and IP, so a stranger cannot exhaust the real admin's attempts from elsewhere.
  adminLoginAccount: policy('admin-login:account-ip', 8, minutes(15)),
  events: policy('events:ip', 120, minutes(1)),
  webhook: policy('webhook:ip', 600, minutes(1)),
} as const;
