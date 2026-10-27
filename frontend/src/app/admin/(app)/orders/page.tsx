import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersPage } from "@/components/admin/orders/OrdersPage";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return (
    <PermissionGate section="orders">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <OrdersPage />
      </Suspense>
    </PermissionGate>
  );
}
