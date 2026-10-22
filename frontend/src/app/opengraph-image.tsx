import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION } from "@/lib/site";

export const alt = "Jetty's Hair";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The default link preview: brand pink, the mark and the tagline. Pages with their own picture (products) override it. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 28, padding: 80, background: "#d61f69", color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ width: 96, height: 96, borderRadius: 28, background: "#ffffff", color: "#d61f69", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 800 }}>J</div>
          <div style={{ fontSize: 72, fontWeight: 800 }}>jetty&apos;s hair</div>
        </div>
        <div style={{ fontSize: 44, maxWidth: 900, lineHeight: 1.2 }}>{SITE_DESCRIPTION}</div>
      </div>
    ),
    size,
  );
}
