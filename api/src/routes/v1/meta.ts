import type { ServerRoute } from '@hapi/hapi';

/**
 * Placeholder endpoint proving the /api/v1 mount and response envelope.
 * Replace with the catalog, pricing, checkout and admin routes in docs/API.md.
 */
export const metaRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/meta',
    options: {
      auth: false,
      description: 'API version metadata',
      tags: ['api', 'meta'],
    },
    handler: () => ({
      data: {
        name: 'jetty-api',
        apiVersion: 'v1',
        currency: 'NGN',
      },
    }),
  },
];
