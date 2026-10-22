"use client";

import { EmptyState } from "@/components/ui";
import { ADMIN_NAV, type AdminNavKey } from "@/lib/admin/nav";
import { permitsAny } from "@/lib/admin/permissions";
import { useAdminSession } from "@/lib/stores/session";
import { PageHeader } from "./PageHeader";

/** A section whose screens are not built yet. It still honours permissions, so the nav never leads somewhere forbidden. */
export function SectionStub({ section }: { section: AdminNavKey }) {
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
  return (
    <>
      <PageHeader title={item.label} subtitle={item.blurb} />
      <EmptyState title="This screen is being built">It will appear here soon.</EmptyState>
    </>
  );
}
