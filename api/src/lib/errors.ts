import Boom from '@hapi/boom';

/**
 * Error envelope from docs/API.md:
 *   { "error": { "code", "message", "requestId", "details" } }
 */
export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown[];
  };
};

/**
 * Raise a domain error with one of the contract's stable codes.
 * `details` is surfaced verbatim, so it must never carry secrets or PII.
 */
export function apiError(
  statusCode: number,
  code: string,
  message: string,
  details?: unknown[],
): Boom.Boom {
  const err = new Boom.Boom(message, { statusCode });
  err.output.payload.message = message;
  err.data = { code, details };
  return err;
}

export const badRequest = (message: string, details?: unknown[]) =>
  apiError(400, 'BAD_REQUEST', message, details);

export const unauthenticated = (message = 'Authentication is required.') =>
  apiError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have access to this resource.') =>
  apiError(403, 'FORBIDDEN', message);

export const notFound = (message = 'The requested resource does not exist.') =>
  apiError(404, 'NOT_FOUND', message);

export const conflict = (code: string, message: string, details?: unknown[]) =>
  apiError(409, code, message, details);

export const unprocessable = (code: string, message: string, details?: unknown[]) =>
  apiError(422, code, message, details);

/** Converts a Joi validation error (from a schema applied inside a handler) into the contract's 422. */
export const fromJoi = (error: { details: { path: (string | number)[]; type: string; message: string }[] }, message = 'The request is invalid.') =>
  unprocessable('VALIDATION_FAILED', message, error.details.map((d) => ({ path: d.path.join('.'), code: d.type, message: d.message })));

/** Fallback HTTP-status-to-code mapping for errors raised outside `apiError`. */
const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
};

export function codeForStatus(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
}
