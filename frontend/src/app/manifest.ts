import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    icons: [
      { src: "/favicons/favicon-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/favicons/favicon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    theme_color: "#FF0082",
    background_color: "#08080A",
    display: "standalone",
  };
}
