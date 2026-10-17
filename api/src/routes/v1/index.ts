import type { ServerRoute } from '@hapi/hapi';
import { catalogRoutes } from './catalog.js';
import { authRoutes } from './auth.js';
import { checkoutRoutes } from './checkout.js';
import { orderRoutes } from './orders.js';
import { pricingRoutes } from './pricing.js';
import { metaRoutes } from './meta.js';

/**
 * Every versioned route is registered here. Paths are declared relative to
 * the root; the /api/v1 prefix is applied once, in server.ts.
 */
export const v1Routes: ServerRoute[] = [...metaRoutes, ...catalogRoutes, ...pricingRoutes, ...checkoutRoutes, ...authRoutes, ...orderRoutes];
