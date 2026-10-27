"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { adminKeys } from "@/lib/admin/keys";
import { permits } from "@/lib/admin/permissions";
import { missingStoreDetails } from "@/lib/admin/settings";
import { getSetting } from "@/lib/api/admin-settings";
import { useAdminSession } from "@/lib/stores/session";

/** On the landing page: which contact details customers cannot see yet, with a link to fill them in. Gone once they are all set. */
export function SetupNudge() {
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const store = useQuery({ queryKey: adminKeys.detail("settings", "store"), queryFn: ({ signal }) => getSetting("store", { signal }), enabled: permits(held, "settings:read"), staleTime: 60_000 });
  const missing = store.data ? missingStoreDetails(store.data) : [];
  if (missing.length === 0) return null;
  return (
    <section aria-label="Finish setting up" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-warning-bg p-4 text-warning">
      <p className="text-body-sm"><strong>Customers can&apos;t see your {missing.join(", ").replace(/, ([^,]*)$/, " or $1")}.</strong> They show in the footer and on the contact page once you add them.</p>
      {permits(held, "settings:write") ? <Link href="/admin/settings/store" className="rounded-pill bg-surface px-4 py-2 font-bold text-ink">Add them</Link> : <span className="text-body-sm">Ask an owner to add them.</span>}
    </section>
  );
}
