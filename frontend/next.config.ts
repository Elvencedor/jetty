import type { NextConfig } from "next";

// The CDN host that serves product images (e.g. media.example.com). Set at build time; without it images are
// served as the API returns them, un-optimised, which is what local development with fake storage wants.
const mediaHost = process.env.NEXT_PUBLIC_MEDIA_HOST;

/** The origin of the API, for the browser's connections to it (blank if the address is missing or not a URL). */
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

/**
 * What the pages may load. It is report-only for now: the browser logs what it would have blocked, nothing breaks, and
 * it can be tightened (and switched to enforcing) once a staging run shows nothing legitimate is flagged. Next needs
 * inline scripts and styles, and Paystack's checkout loads its script and a frame.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.paystack.co",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} https://api.paystack.co https://checkout.paystack.com`.trim(),
  "frame-src https://checkout.paystack.com https://js.paystack.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: mediaHost ? [{ protocol: "https", hostname: mediaHost }] : [],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
