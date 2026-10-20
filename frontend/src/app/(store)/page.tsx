import { connection } from "next/server";
import { Suspense } from "react";
import { HomeSections } from "@/components/home/HomeSections";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { currentTime } from "@/lib/clock";
import { getHomeCached } from "@/lib/catalog/data";
import { reportError } from "@/lib/monitoring";

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
    <div className="mx-auto flex w-full max-w-store flex-col gap-7 px-4 pt-4">
      <h1 className="sr-only">Jetty&rsquo;s Hair</h1>
      <Suspense fallback={<Skeleton className="h-[380px] w-full rounded-xl" />}>
        <Home />
      </Suspense>
    </div>
  );
}
