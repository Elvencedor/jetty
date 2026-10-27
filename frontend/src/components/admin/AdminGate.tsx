"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/stores/session";

/**
 * Shows its children only to a signed-in admin. Anyone else (or anyone whose session ends while the page is open,
 * for example when the API stops accepting their token) is sent to sign in and brought back afterwards, and the
 * admin data held in memory is dropped so it cannot be seen by whoever signs in next.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const status = useAdminSession((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status !== "anonymous") return;
    queryClient.removeQueries({ queryKey: adminKeys.all });
    router.replace(`/admin/login?next=${encodeURIComponent(query ? `${pathname}?${query}` : pathname)}`);
  }, [status, router, pathname, query, queryClient]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-dvh flex-col bg-surface-subtle" aria-busy="true">
        <div className="h-[62px] border-b border-line bg-surface" />
        <div className="mx-auto w-full max-w-admin p-6"><Skeleton className="h-10 w-1/3" /><Skeleton className="mt-4 h-64 w-full" /></div>
      </div>
    );
  }
  return <>{children}</>;
}
