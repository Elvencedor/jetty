import { randomUUID } from 'node:crypto';
import type { Plugin, Request, ResponseObject } from '@hapi/hapi';
import type { Logger } from '../lib/logger.js';

declare module '@hapi/hapi' {
  interface RequestApplicationState {
    requestId: string;
    logger: Logger;
  }
}

const HEADER = 'x-request-id';

/**
 * Assigns a request ID (honouring an upstream `x-request-id` so Cloudflare and
 * Vercel traces line up), exposes a per-request child logger, echoes the ID on
 * every response, and logs one structured line per completed request.
 */
export function requestContext(logger: Logger): Plugin<void> {
  return {
    name: 'jetty-request-context',
    register(server) {
      server.ext('onRequest', (request, h) => {
        const upstream = request.headers[HEADER];
        const requestId =
          typeof upstream === 'string' && /^[\w.:-]{1,128}$/.test(upstream)
            ? upstream
            : `req_${randomUUID().replace(/-/g, '')}`;

        request.app.requestId = requestId;
        request.app.logger = logger.child({ requestId });
        return h.continue;
      });

      server.ext('onPreResponse', (request, h) => {
        const requestId = request.app.requestId;
        if (!requestId) return h.continue;

        const response = request.response;
        if (response instanceof Error) response.output.headers[HEADER] = requestId;
        else (response as ResponseObject).header(HEADER, requestId);

        return h.continue;
      });

      server.events.on('response', (request: Request) => {
        const status =
          request.response instanceof Error
            ? request.response.output.statusCode
            : (request.response as ResponseObject)?.statusCode;

        const log = request.app.logger ?? logger;
        const fields = {
          method: request.method.toUpperCase(),
          path: request.route.path,
          statusCode: status,
          durationMs: Date.now() - request.info.received,
        };

        if (status && status >= 500) log.error('request failed', fields);
        else log.info('request completed', fields);
      });
    },
  };
}
