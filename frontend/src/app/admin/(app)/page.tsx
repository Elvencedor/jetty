import type { Metadata } from "next";
import { Suspense } from "react";
import { Overview } from "@/components/admin/Overview";

export const metadata: Metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return (
    <Suspense>
      <Overview />
    </Suspense>
  );
}
