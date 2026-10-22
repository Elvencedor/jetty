import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/** Public catalogue and info pages may be crawled; anything personal, transactional or internal may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/bag", "/checkout", "/order/", "/track", "/saved", "/search", "/dev"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
