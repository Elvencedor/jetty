"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { reportError } from "@/lib/monitoring";

/** Catches an unexpected error anywhere below the root layout and offers a retry. */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error, { source: "route", digest: error.digest });
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-store flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="font-display text-heading-md font-extrabold text-ink">Something went wrong</h1>
      <p className="max-w-md text-body text-muted">We hit a problem loading this page. Your bag is safe. Try again, and if it keeps happening, message us on WhatsApp.</p>
      {error.digest ? <p className="text-caption text-muted">Reference: {error.digest}</p> : null}
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" href="/">
          Back to home
        </Button>
      </div>
    </main>
  );
}
