import { connection } from "next/server";
import { Suspense } from "react";
import { HomeTop } from "@/components/shell/MobileTop";
import { HomeSections } from "@/components/home/HomeSections";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { currentTime } from "@/lib/clock";
import { getHomeCached } from "@/lib/catalog/data";
import { reportError } from "@/lib/monitoring";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const metadata = { alternates: { canonical: "/" } };

/** Who the site is, and how its search works, for search engines. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/"), description: SITE_DESCRIPTION },
    { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/"), potentialAction: { "@type": "SearchAction", target: absoluteUrl("/search?q={search_term_string}"), "query-input": "required name=search_term_string" } },
  ],
};

async function Home() {
  await connection();
  const home = await getHomeCached().catch((err) => (reportError(err, { source: "home" }), null));
  if (!home) {
    return <EmptyState title="We couldn't load the store" action={<Button href="/shop">Browse all wigs</Button>}>
        Check your connection and try again.
      </EmptyState>;
  }
  return <HomeSections sections={home.sections} now={currentTime()} />;
}

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-store">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c") }} />
      <h1 className="sr-only">Jetty&rsquo;s Hair</h1>
      <HomeTop />
      <div className="flex flex-col gap-7 px-4 pt-2 lg:pt-6">
        <Suspense
          fallback={
            // The same shape as the real thing (a row of stories, then a hero card), and tall enough that the footer
            // stays below the fold until the real content arrives, so nothing visible moves.
            <div className="flex min-h-[100dvh] flex-col gap-7">
              <Skeleton className="h-[96px] w-full" />
              <Skeleton className="h-[380px] w-full rounded-xl" />
            </div>
          }
        >
          <Home />
        </Suspense>
      </div>
    </div>
  );
}
