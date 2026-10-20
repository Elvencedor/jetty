"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/monitoring";

/** Last resort when the root layout itself fails; it replaces the layout, so it brings its own <html> and <body>. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error, { source: "global", digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#fff", color: "#2b0d1c", textAlign: "center", padding: 24 }}>
        <main id="main">
          <h1 style={{ fontSize: 26, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#74525f" }}>Please try again in a moment.</p>
          <button onClick={() => retry()} style={{ background: "#d61f69", color: "#fff", border: 0, borderRadius: 9999, padding: "12px 24px", fontWeight: 700, fontSize: 16 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
