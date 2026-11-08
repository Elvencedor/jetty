import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersPage } from "@/components/admin/orders/OrdersPage";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Orders" };

// Rendered only once the browser confirms an admin session (AdminGate), so there is nothing for Next to validate.
export const instant = false;

export default function AdminOrdersPage() {
  return (
    <PermissionGate section="orders">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <OrdersPage />
      </Suspense>
    </PermissionGate>
  );
}
