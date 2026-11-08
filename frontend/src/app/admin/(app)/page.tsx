import type { Metadata } from "next";
import { Suspense } from "react";
import { Overview } from "@/components/admin/Overview";

export const metadata: Metadata = { title: "Overview" };

// Rendered only once the browser confirms an admin session (AdminGate), so there is nothing for Next to validate.
export const instant = false;

export default function AdminOverviewPage() {
  return (
    <Suspense>
      <Overview />
    </Suspense>
  );
}
