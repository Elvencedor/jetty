"use client";

import { EmptyState } from "@/components/ui";
import { ADMIN_NAV, type AdminNavKey } from "@/lib/admin/nav";
import { PageHeader } from "./PageHeader";
import { PermissionGate } from "./PermissionGate";

/** A section whose screens are not built yet. It still honours permissions, so the nav never leads somewhere forbidden. */
export function SectionStub({ section }: { section: AdminNavKey }) {
  const item = ADMIN_NAV.find((i) => i.key === section)!;
  return (
    <PermissionGate section={section}>
      <PageHeader title={item.label} subtitle={item.blurb} />
      <EmptyState title="This screen is being built">It will appear here soon.</EmptyState>
    </PermissionGate>
  );
}
