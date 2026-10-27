"use client";

import { useCallback, useEffect, useState } from "react";

/** A countdown in whole seconds for "resend in 42s". `start(n)` begins it; it stops at zero. */
export function useCooldown() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => {
      const remaining = Math.max(Math.ceil((endsAt - Date.now()) / 1000), 0);
      setLeft(remaining);
      if (remaining === 0) setEndsAt(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  const start = useCallback((seconds: number) => setEndsAt(Date.now() + seconds * 1000), []);
  return { left, start };
}
