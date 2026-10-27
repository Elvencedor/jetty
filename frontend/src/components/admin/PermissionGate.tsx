"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui";
import { ADMIN_NAV, type AdminNavKey } from "@/lib/admin/nav";
import { permitsAny } from "@/lib/admin/permissions";
import { useAdminSession } from "@/lib/stores/session";
import { PageHeader } from "./PageHeader";

/** Shows a section only to roles that can use it; others are told so (the API refuses them in any case). */
export function PermissionGate({ section, children }: { section: AdminNavKey; children: ReactNode }) {
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const item = ADMIN_NAV.find((i) => i.key === section)!;
  if (!permitsAny(held, item.needs)) {
    return (
      <>
        <PageHeader title={item.label} />
        <EmptyState title="You don't have access to this section">Ask an owner if you need it.</EmptyState>
      </>
    );
  }
  return <>{children}</>;
}
