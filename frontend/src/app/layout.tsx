import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { Providers } from "@/components/providers";
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
  title: {
    default: "Jetty's Hair",
    template: "%s | Jetty's Hair",
  },
  description: "Shop premium wigs and hair care, delivered across Nigeria.",
};

export const viewport: Viewport = {
  themeColor: "#d61f69",
  // Lets the sticky bars and tab bar use env(safe-area-inset-bottom) on notched phones.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
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
