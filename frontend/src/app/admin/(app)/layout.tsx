import { Suspense } from "react";
import { AdminGate } from "@/components/admin/AdminGate";
import { AdminShell } from "@/components/admin/AdminShell";

export default function AdminAppLayout({ children }: LayoutProps<"/admin">) {
  return (
    // The gate reads the address (to come back after signing in), which is only known per request.
    <Suspense fallback={null}>
      <AdminGate>
        <AdminShell>{children}</AdminShell>
      </AdminGate>
    </Suspense>
  );
}
