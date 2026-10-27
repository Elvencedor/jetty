import type { Plugin } from '@hapi/hapi';
import type Boom from '@hapi/boom';
import { codeForStatus, type ErrorEnvelope } from '../lib/errors.js';

type ErrorData = { code?: string; details?: unknown[] };

/**
 * Renders every error as the single envelope documented in docs/API.md and
 * strips internal detail from 5xx responses, so stack traces and provider
 * credentials can never reach a client.
 */
export function errorEnvelope(options: { isProduction: boolean }): Plugin<void> {
  return {
    name: 'jetty-error-envelope',
    register(server) {
      server.ext('onPreResponse', (request, h) => {
        const response = request.response;
        if (!(response instanceof Error)) return h.continue;

        const boom = response as Boom.Boom;
        const statusCode = boom.output.statusCode;
        const data = (boom.data ?? {}) as ErrorData;
        const isServerError = statusCode >= 500;
        const requestId = request.app.requestId ?? 'unknown';

        if (isServerError) {
          request.app.logger?.error('unhandled error', {
            statusCode,
            err: boom.message,
            stack: options.isProduction ? undefined : boom.stack,
          });
        }

        // hapi reports route-validation failures as 400s; the contract
        // reports syntactically valid but invalid fields as 422.
        const isValidation = Boolean(boom.output.payload.validation);
        const effectiveStatus = isValidation ? 422 : statusCode;

        const envelope: ErrorEnvelope = {
          error: {
            code: data.code ?? (isValidation ? 'VALIDATION_FAILED' : codeForStatus(effectiveStatus)),
            message: isServerError
              ? 'An unexpected error occurred.'
              : boom.output.payload.message || boom.message,
            requestId,
            ...(data.details ? { details: data.details } : {}),
          },
        };

        // This response replaces the one request-context decorated, so the
        // correlation header is re-applied here.
        const reply = h.response(envelope).code(effectiveStatus);
        for (const [name, value] of Object.entries(boom.output.headers)) reply.header(name, String(value));
        return reply.header('x-request-id', requestId).takeover();
      });
    },
  };
}
