"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * One piece of page state kept in the address bar (`?order=abc`), so it survives reload and can be shared, and the
 * back button closes what the forward button opened. Other parameters are left alone. Setting `null` removes it.
 * `push` adds a history entry (opening a drawer); the default replaces the current one (changing a filter).
 */
export function useUrlState(key: string): [string | null, (value: string | null, options?: { push?: boolean }) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(key);
  const set = useCallback(
    (next: string | null, { push = false }: { push?: boolean } = {}) => {
      const query = new URLSearchParams(window.location.search);
      if (next === null) query.delete(key);
      else query.set(key, next);
      const qs = query.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      if (push) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [key, pathname, router],
  );
  return [value, set];
}
