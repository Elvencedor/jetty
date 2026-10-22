"use client";

import { useEffect } from "react";

/**
 * While `dirty`, closing the tab or reloading asks the browser's "leave site?" question. (In-app closing is guarded
 * by the drawer and the forms themselves, which ask before discarding.)
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required by some browsers to show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
