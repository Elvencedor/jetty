/**
 * Typed client for the hapi API in ../../api.
 *
 * Mirrors the contract in docs/API.md: success responses are bare resources or
 * `{ data }`, collections add a `page` envelope, and failures return
 * `{ error: { code, message, requestId, details } }`.
 */

export type ApiPage = { nextCursor: string | null };

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown[];
  };
};

/** Thrown for any non-2xx response, carrying the contract's stable error code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details: unknown[] | undefined;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.requestId = body.requestId;
    this.details = body.details;
  }
}

function baseUrl(): string {
  const url =
    (typeof window === 'undefined' ? process.env.API_BASE_URL : undefined) ??
    process.env.NEXT_PUBLIC_API_BASE_URL;

  if (!url) {
    throw new Error(
      'API base URL is not configured. Set API_BASE_URL (server) and NEXT_PUBLIC_API_BASE_URL (browser).',
    );
  }

  return url.replace(/\/+$/, '');
}

export type RequestOptions = Omit<RequestInit, 'body'> & {
  /** Serialised as JSON. */
  body?: unknown;
  /** Required by the contract for checkout and payment operations. */
  idempotencyKey?: string;
};

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, headers, ...init } = options;

  const response = await fetch(`${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const envelope = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      envelope?.error ?? {
        code: 'REQUEST_FAILED',
        message: response.statusText || 'The request failed.',
        requestId: response.headers.get('x-request-id') ?? 'unknown',
      },
    );
  }

  return payload as T;
}

/** Amounts cross the wire as integer minor units; the storefront formats Naira. */
export function formatNaira(amountMinor: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}
