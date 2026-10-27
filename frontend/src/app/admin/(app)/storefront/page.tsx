import type { Metadata } from "next";
import { Suspense } from "react";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { StorefrontPage } from "@/components/admin/storefront/StorefrontPage";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Storefront" };

export default function AdminStorefrontPage() {
  return (
    <PermissionGate section="storefront">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <StorefrontPage />
      </Suspense>
    </PermissionGate>
  );
}
