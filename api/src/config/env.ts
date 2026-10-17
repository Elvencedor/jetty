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

  return {
    NODE_ENV: value.NODE_ENV,
    HOST: value.HOST,
    PORT: value.PORT,
    LOG_LEVEL: value.LOG_LEVEL,
    DATABASE_URL: value.DATABASE_URL,
    PAYSTACK_SECRET_KEY: value.PAYSTACK_SECRET_KEY,
    PAYSTACK_WEBHOOK_SECRET: value.PAYSTACK_WEBHOOK_SECRET,
    WEBHOOK_PORT: value.WEBHOOK_PORT,
    PAYSTACK_BASE_URL: value.PAYSTACK_BASE_URL,
    PAYSTACK_CALLBACK_URL: value.PAYSTACK_CALLBACK_URL,
    corsOrigins: String(value.CORS_ORIGINS)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    isProduction: value.NODE_ENV === 'production',
  };
}
