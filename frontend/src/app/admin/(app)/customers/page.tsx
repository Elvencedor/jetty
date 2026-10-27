import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomersPage } from "@/components/admin/customers/CustomersPage";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Customers" };

export default function AdminCustomersPage() {
  return (
    <PermissionGate section="customers">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <CustomersPage />
      </Suspense>
    </PermissionGate>
  );
}
