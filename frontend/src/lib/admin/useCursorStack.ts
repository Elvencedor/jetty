"use client";

import { useState } from "react";

/**
 * Previous / Next over cursor-paged lists. The API only gives the cursor of the next page, so the cursors already
 * visited are remembered and "Previous" steps back through them. Call `reset` when the filters change.
 */
export function useCursorStack() {
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const index = stack.length - 1;
  return {
    cursor: stack[index],
    index,
    canPrev: index > 0,
    next: (cursor: string) => setStack((s) => [...s, cursor]),
    prev: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    reset: () => setStack([undefined]),
  };
}

/** The 1-based range of rows on a page, for "Showing 9–16 of 40". */
export function pageRange(index: number, pageSize: number, count: number): { from: number; to: number } {
  return count === 0 ? { from: 0, to: 0 } : { from: index * pageSize + 1, to: index * pageSize + count };
}
