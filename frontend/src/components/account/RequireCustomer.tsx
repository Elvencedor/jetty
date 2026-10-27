"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui";
import { useCustomerSession } from "@/lib/stores/session";

/** Shows its children only to a signed-in customer; anyone else is sent to sign in and brought back afterwards. */
export function RequireCustomer({ children }: { children: ReactNode }) {
  const status = useCustomerSession((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    if (status === "anonymous") router.replace(`/account/sign-in?next=${encodeURIComponent(query ? `${pathname}?${query}` : pathname)}`);
  }, [status, router, pathname, query]);
  if (status !== "authenticated") return <Skeleton className="mx-auto h-64 w-full max-w-xl" />;
  return <>{children}</>;
}
