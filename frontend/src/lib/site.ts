/**
 * The public address of the storefront, for absolute links in the sitemap, canonical URLs and structured data.
 * Set `NEXT_PUBLIC_SITE_URL` (no trailing slash) in production; local development falls back to localhost.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export const absoluteUrl = (path: string) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

export const SITE_NAME = "Jetty's Hair";
export const SITE_DESCRIPTION = "Premium wigs and hair care, delivered across Nigeria.";
