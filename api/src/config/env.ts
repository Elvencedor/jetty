import Joi from 'joi';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  HOST: Joi.string().hostname().default('0.0.0.0'),
  PORT: Joi.number().port().default(4000),
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
  // Comma-separated list of browser origins allowed to call the API.
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.optional() }),
  // Paystack secret key; server-side only. Checkout returns 503 until it is set.
  PAYSTACK_SECRET_KEY: Joi.string().min(8).optional(),
  // Paystack signs webhooks with the secret key; set this only if a separate signing secret is ever issued.
  PAYSTACK_WEBHOOK_SECRET: Joi.string().min(8).optional(),
  // Port of the standalone webhook service (falls back to PORT, which Railway sets per service).
  WEBHOOK_PORT: Joi.number().port().optional(),
  // HMAC key for customer access tokens (at least 32 characters). Auth routes return 503 until it is set.
  AUTH_TOKEN_SECRET: Joi.string().min(32).optional(),
  // Per-IP/account request limits (Redis-backed, so REDIS_URL is required when on). Off by default under NODE_ENV=test.
  RATE_LIMIT_ENABLED: Joi.boolean().when('NODE_ENV', { is: 'test', then: Joi.boolean().default(false), otherwise: Joi.boolean().default(true) }),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).optional(),
  // Number of proxies we control in front of the API (Railway: 1, Cloudflare + Railway: 2); 0 uses the socket address.
  TRUSTED_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(0),
  // Paystack requires an email; customers without one get a per-phone address on this domain (use a mailbox-less domain you control).
  PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN: Joi.string().domain({ tlds: { allow: false } }).default('noemail.jettyshair.com'),
  // Notification providers. 'log' prints messages (including one-time codes) and is refused in production.
  SMS_PROVIDER: Joi.string().valid('log', 'termii').default('log'),
  TERMII_API_KEY: Joi.string().when('SMS_PROVIDER', { is: 'termii', then: Joi.required(), otherwise: Joi.optional() }),
  TERMII_SENDER_ID: Joi.string().when('SMS_PROVIDER', { is: 'termii', then: Joi.required(), otherwise: Joi.optional() }),
  TERMII_BASE_URL: Joi.string().uri({ scheme: ['https', 'http'] }).default('https://api.ng.termii.com'),
  EMAIL_PROVIDER: Joi.string().valid('log', 'resend').default('log'),
  RESEND_API_KEY: Joi.string().when('EMAIL_PROVIDER', { is: 'resend', then: Joi.required(), otherwise: Joi.optional() }),
  EMAIL_FROM: Joi.string().when('EMAIL_PROVIDER', { is: 'resend', then: Joi.required(), otherwise: Joi.optional() }),
  PAYSTACK_BASE_URL: Joi.string().uri({ scheme: ['https', 'http'] }).default('https://api.paystack.co'),
  // Where Paystack redirects the browser after payment; the page must verify server-side.
  PAYSTACK_CALLBACK_URL: Joi.string().uri({ scheme: ['https', 'http'] }).optional(),
}).unknown(true);

export type Env = {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  DATABASE_URL: string | undefined;
  PAYSTACK_SECRET_KEY: string | undefined;
  PAYSTACK_WEBHOOK_SECRET: string | undefined;
  WEBHOOK_PORT: number | undefined;
  AUTH_TOKEN_SECRET: string | undefined;
  REDIS_URL: string | undefined;
  RATE_LIMIT_ENABLED: boolean;
  TRUSTED_PROXY_HOPS: number;
  PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN: string;
  SMS_PROVIDER: 'log' | 'termii';
  TERMII_API_KEY: string | undefined;
  TERMII_SENDER_ID: string | undefined;
  TERMII_BASE_URL: string;
  EMAIL_PROVIDER: 'log' | 'resend';
  RESEND_API_KEY: string | undefined;
  EMAIL_FROM: string | undefined;
  PAYSTACK_BASE_URL: string;
  PAYSTACK_CALLBACK_URL: string | undefined;
  corsOrigins: string[];
  isProduction: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const { value, error } = schema.validate(source, { abortEarly: false, stripUnknown: false });

  if (error) {
    const details = error.details.map((d) => d.message).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  if (value.RATE_LIMIT_ENABLED && !value.REDIS_URL) {
    throw new Error('Invalid environment configuration: "REDIS_URL" is required when RATE_LIMIT_ENABLED is true');
  }

  return {
    NODE_ENV: value.NODE_ENV,
    HOST: value.HOST,
    PORT: value.PORT,
    LOG_LEVEL: value.LOG_LEVEL,
    DATABASE_URL: value.DATABASE_URL,
    PAYSTACK_SECRET_KEY: value.PAYSTACK_SECRET_KEY,
    PAYSTACK_WEBHOOK_SECRET: value.PAYSTACK_WEBHOOK_SECRET,
    WEBHOOK_PORT: value.WEBHOOK_PORT,
    AUTH_TOKEN_SECRET: value.AUTH_TOKEN_SECRET,
    REDIS_URL: value.REDIS_URL,
    RATE_LIMIT_ENABLED: value.RATE_LIMIT_ENABLED,
    TRUSTED_PROXY_HOPS: value.TRUSTED_PROXY_HOPS,
    PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN: value.PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN,
    SMS_PROVIDER: value.SMS_PROVIDER,
    TERMII_API_KEY: value.TERMII_API_KEY,
    TERMII_SENDER_ID: value.TERMII_SENDER_ID,
    TERMII_BASE_URL: value.TERMII_BASE_URL,
    EMAIL_PROVIDER: value.EMAIL_PROVIDER,
    RESEND_API_KEY: value.RESEND_API_KEY,
    EMAIL_FROM: value.EMAIL_FROM,
    PAYSTACK_BASE_URL: value.PAYSTACK_BASE_URL,
    PAYSTACK_CALLBACK_URL: value.PAYSTACK_CALLBACK_URL,
    corsOrigins: String(value.CORS_ORIGINS)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    isProduction: value.NODE_ENV === 'production',
  };
}
