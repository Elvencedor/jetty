import type { ServerRoute } from '@hapi/hapi';
import { adminAnalyticsRoutes } from './admin/analytics.js';
import { adminAuthRoutes } from './admin/auth.js';
import { adminCatalogRoutes } from './admin/catalog.js';
import { adminManagementRoutes } from './admin/management.js';
import { adminOrderRoutes } from './admin/orders.js';
import { adminPromotionRoutes } from './admin/promotions.js';
import { catalogRoutes } from './catalog.js';
import { authRoutes } from './auth.js';
import { checkoutRoutes } from './checkout.js';
import { orderRoutes } from './orders.js';
import { pricingRoutes } from './pricing.js';
import { metaRoutes } from './meta.js';
import { storefrontRoutes } from './storefront.js';

/**
 * Every versioned route is registered here. Paths are declared relative to
 * the root; the /api/v1 prefix is applied once, in server.ts.
 */
export const v1Routes: ServerRoute[] = [...metaRoutes, ...catalogRoutes, ...pricingRoutes, ...checkoutRoutes, ...authRoutes, ...orderRoutes, ...storefrontRoutes, ...adminAuthRoutes, ...adminCatalogRoutes, ...adminOrderRoutes, ...adminPromotionRoutes, ...adminManagementRoutes, ...adminAnalyticsRoutes];
