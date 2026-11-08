import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsPage } from "@/components/admin/products/ProductsPage";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Products" };

// Rendered only once the browser confirms an admin session (AdminGate), so there is nothing for Next to validate.
export const instant = false;

export default function AdminProductsPage() {
  return (
    <PermissionGate section="products">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ProductsPage />
      </Suspense>
    </PermissionGate>
  );
}
