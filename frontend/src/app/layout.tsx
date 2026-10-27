import type { Metadata, Viewport } from "next";
import { preconnect } from "react-dom";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { Providers } from "@/components/providers";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_NG", title: SITE_NAME, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#d61f69",
  // Lets the sticky bars and tab bar use env(safe-area-inset-bottom) on notched phones.
  viewportFit: "cover",
};

/** Origins the browser talks to straight away (the API for prices and delivery, the CDN for photos): connect early. */
function warmConnections() {
  for (const url of [process.env.NEXT_PUBLIC_API_BASE_URL, process.env.NEXT_PUBLIC_MEDIA_HOST ? `https://${process.env.NEXT_PUBLIC_MEDIA_HOST}` : undefined]) {
    if (!url) continue;
    try {
      preconnect(new URL(url).origin);
    } catch {
      // A malformed address is a configuration problem reported elsewhere; skip the hint.
    }
  }
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  warmConnections();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="flex min-h-screen-safe flex-col">
        {/* Every layout below this one renders <main id="main">. */}
        <a
          href="#main"
          className="sr-only rounded-pill bg-primary px-4 py-2 text-label font-semibold text-on-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
