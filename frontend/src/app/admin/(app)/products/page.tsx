import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsPage } from "@/components/admin/products/ProductsPage";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Products" };

export default function AdminProductsPage() {
  return (
    <PermissionGate section="products">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ProductsPage />
      </Suspense>
    </PermissionGate>
  );
}
