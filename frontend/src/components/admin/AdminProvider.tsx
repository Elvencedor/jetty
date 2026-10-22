"use client";

import { useEffect, type ReactNode } from "react";
import { startSession } from "@/lib/session/bootstrap";
import { Toaster } from "./Toaster";

/** Keeps the admin session alive for as long as an admin page is open (restores it from the cookie, renews the token). */
export function AdminProvider({ children }: { children: ReactNode }) {
  useEffect(() => startSession("admin"), []);
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
