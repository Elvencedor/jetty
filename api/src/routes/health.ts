import type { ServerRoute } from '@hapi/hapi';

/**
 * Liveness and readiness probes, kept outside /api/v1 so platform health
 * checks never depend on the versioned contract.
 *
 * `/readyz` reports 503 while a required dependency (PostgreSQL) is
 * unreachable. The database check is skipped only when none is configured
 * (local development and tests).
 */
export const healthRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/healthz',
    options: {
      auth: false,
      description: 'Liveness probe',
      tags: ['health'],
    },
    handler: () => ({ status: 'ok' }),
  },
  {
    method: 'GET',
    path: '/readyz',
    options: {
      auth: false,
      description: 'Readiness probe',
      tags: ['health'],
    },
    handler: async (request, h) => {
      const { database, logger } = request.server.app;
      let databaseCheck: 'ok' | 'unavailable' | 'skipped' = 'skipped';

      if (database) {
        try {
          await database.ping();
          databaseCheck = 'ok';
        } catch (err) {
          databaseCheck = 'unavailable';
          logger.error('readiness database check failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const ready = databaseCheck !== 'unavailable';
      return h
        .response({
          status: ready ? 'ready' : 'unavailable',
          checks: { database: databaseCheck },
          uptimeSeconds: Math.floor(process.uptime()),
        })
        .code(ready ? 200 : 503);
    },
  },
];
