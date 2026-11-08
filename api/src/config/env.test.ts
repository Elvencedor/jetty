import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadEnv } from './env.js';

const base = { NODE_ENV: 'test' };
const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv defaults', () => {
  it('applies development defaults for an empty environment', () => {
    const env = loadEnv({ REDIS_URL: 'redis://localhost:6379' });
    assert.equal(env.NODE_ENV, 'development');
    assert.equal(env.PORT, 4000);
    assert.equal(env.HOST, '0.0.0.0');
    assert.equal(env.LOG_LEVEL, 'info');
    assert.equal(env.isProduction, false);
    assert.equal(env.TRUSTED_PROXY_HOPS, 0);
    assert.equal(env.SMS_PROVIDER, 'log');
    assert.equal(env.EMAIL_PROVIDER, 'log');
    assert.equal(env.MEDIA_S3_REGION, 'auto');
    assert.equal(env.PAYSTACK_BASE_URL, 'https://api.paystack.co');
    assert.equal(env.PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN, 'noemail.jettyshair.com');
    assert.deepEqual(env.corsOrigins, ['http://localhost:3000']);
  });

  it('coerces numeric strings', () => {
    const env = loadEnv({ ...base, PORT: '8080', TRUSTED_PROXY_HOPS: '2' });
    assert.equal(env.PORT, 8080);
    assert.equal(env.TRUSTED_PROXY_HOPS, 2);
  });

  it('ignores unrelated variables', () => {
    assert.doesNotThrow(() => loadEnv({ ...base, SOMETHING_ELSE: 'x' }));
  });
});

describe('CORS origins', () => {
  it('splits, trims and drops empty entries', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: ' https://a.com , https://b.com,, ' });
    assert.deepEqual(env.corsOrigins, ['https://a.com', 'https://b.com']);
  });
});

describe('rate limiting config', () => {
  it('is off under NODE_ENV=test without Redis', () => {
    assert.equal(loadEnv(base).RATE_LIMIT_ENABLED, false);
  });
  it('is on by default outside test, and then needs REDIS_URL', () => {
    assert.throws(() => loadEnv({ NODE_ENV: 'development' }), /REDIS_URL/);
    assert.equal(loadEnv({ NODE_ENV: 'development', REDIS_URL: 'redis://localhost' }).RATE_LIMIT_ENABLED, true);
  });
  it('can be switched off explicitly', () => {
    assert.equal(loadEnv({ NODE_ENV: 'development', RATE_LIMIT_ENABLED: 'false' }).RATE_LIMIT_ENABLED, false);
  });
  it('can be switched on in test when Redis is given, and fails without it', () => {
    assert.equal(loadEnv({ ...base, RATE_LIMIT_ENABLED: 'true', REDIS_URL: 'rediss://host:6380' }).RATE_LIMIT_ENABLED, true);
    assert.throws(() => loadEnv({ ...base, RATE_LIMIT_ENABLED: 'true' }), /REDIS_URL/);
  });
  it('rejects a non-redis URL scheme', () => {
    assert.throws(() => loadEnv({ ...base, REDIS_URL: 'http://localhost' }), /REDIS_URL/);
  });
  it('bounds the trusted proxy hops', () => {
    assert.throws(() => loadEnv({ ...base, TRUSTED_PROXY_HOPS: '6' }), /TRUSTED_PROXY_HOPS/);
    assert.throws(() => loadEnv({ ...base, TRUSTED_PROXY_HOPS: '-1' }), /TRUSTED_PROXY_HOPS/);
  });
});

describe('production requirements', () => {
  it('accepts a complete production configuration', () => {
    const env = loadEnv({ ...prod, SMS_PROVIDER: 'termii', TERMII_API_KEY: 'k', TERMII_SENDER_ID: 'Jetty' });
    assert.equal(env.isProduction, true);
  });
  it('requires DATABASE_URL', () => {
    const { DATABASE_URL: _drop, ...rest } = prod;
    assert.throws(() => loadEnv(rest), /DATABASE_URL/);
  });
  it('requires a postgres URL', () => {
    assert.throws(() => loadEnv({ ...prod, DATABASE_URL: 'mysql://x' }), /DATABASE_URL/);
    assert.doesNotThrow(() => loadEnv({ ...prod, DATABASE_URL: 'postgresql://u:p@h/db' }));
  });
  it('refuses to guess the environment on Railway', () => {
    assert.throws(() => loadEnv({ RAILWAY_ENVIRONMENT: 'production' }), /NODE_ENV must be set explicitly/);
    assert.doesNotThrow(() => loadEnv({ ...prod, RAILWAY_ENVIRONMENT: 'production' }));
  });
});

describe('secrets and provider coupling', () => {
  it('requires AUTH_TOKEN_SECRET to be at least 32 characters when given', () => {
    assert.throws(() => loadEnv({ ...base, AUTH_TOKEN_SECRET: 'short' }), /AUTH_TOKEN_SECRET/);
    assert.equal(loadEnv({ ...base, AUTH_TOKEN_SECRET: 'x'.repeat(32) }).AUTH_TOKEN_SECRET, 'x'.repeat(32));
  });
  it('requires PAYSTACK_SECRET_KEY to be at least 8 characters when given', () => {
    assert.throws(() => loadEnv({ ...base, PAYSTACK_SECRET_KEY: 'sk' }), /PAYSTACK_SECRET_KEY/);
  });
  it('requires Termii credentials when Termii is selected', () => {
    assert.throws(() => loadEnv({ ...base, SMS_PROVIDER: 'termii' }), /TERMII_API_KEY/);
    assert.doesNotThrow(() => loadEnv({ ...base, SMS_PROVIDER: 'termii', TERMII_API_KEY: 'k', TERMII_SENDER_ID: 's' }));
  });
  it('requires Resend credentials when Resend is selected', () => {
    assert.throws(() => loadEnv({ ...base, EMAIL_PROVIDER: 'resend' }), /RESEND_API_KEY/);
    assert.doesNotThrow(() => loadEnv({ ...base, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.com' }));
  });
  it('rejects unknown providers', () => {
    assert.throws(() => loadEnv({ ...base, SMS_PROVIDER: 'twilio' }), /SMS_PROVIDER/);
  });
  it('needs a REVALIDATE_SECRET (16+ chars) whenever the revalidate URL is set', () => {
    const url = 'https://shop.example.com/api/revalidate';
    assert.throws(() => loadEnv({ ...base, STOREFRONT_REVALIDATE_URL: url }), /REVALIDATE_SECRET/);
    assert.throws(() => loadEnv({ ...base, STOREFRONT_REVALIDATE_URL: url, REVALIDATE_SECRET: 'short' }), /REVALIDATE_SECRET/);
    assert.doesNotThrow(() => loadEnv({ ...base, STOREFRONT_REVALIDATE_URL: url, REVALIDATE_SECRET: 'x'.repeat(16) }));
  });
  it('validates the ops alert email', () => {
    assert.throws(() => loadEnv({ ...base, OPS_ALERT_EMAIL: 'nope' }), /OPS_ALERT_EMAIL/);
    assert.equal(loadEnv({ ...base, OPS_ALERT_EMAIL: 'ops@jettyshair.com' }).OPS_ALERT_EMAIL, 'ops@jettyshair.com');
  });
  it('reports every problem at once', () => {
    assert.throws(() => loadEnv({ ...base, PORT: 'abc', LOG_LEVEL: 'loud' }), /PORT.*LOG_LEVEL|LOG_LEVEL.*PORT/s);
  });
});
