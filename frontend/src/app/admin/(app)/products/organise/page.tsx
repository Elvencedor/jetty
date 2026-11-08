import type { Metadata } from "next";
import { Suspense } from "react";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { TaxonomyPage } from "@/components/admin/taxonomy/TaxonomyPage";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Categories & collections" };

// Rendered only once the browser confirms an admin session (AdminGate), so there is nothing for Next to validate.
export const instant = false;

export default function AdminTaxonomyPage() {
  return (
    <PermissionGate section="products">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <TaxonomyPage />
      </Suspense>
    </PermissionGate>
  );
}
