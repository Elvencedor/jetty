import type { NextConfig } from "next";

// The CDN host that serves product images (e.g. media.example.com). Set at build time; without it images are
// served as the API returns them, un-optimised, which is what local development with fake storage wants.
const mediaHost = process.env.NEXT_PUBLIC_MEDIA_HOST;

const nextConfig: NextConfig = {
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
