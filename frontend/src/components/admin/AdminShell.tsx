import type { ReactNode } from "react";
import { AdminTopNav } from "./AdminTopNav";

/** The frame around every admin screen: the top bar, then the content in a centred column on the pale page. */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-subtle text-body-sm">
      <AdminTopNav />
      <main id="main" className="mx-auto flex w-full max-w-admin flex-1 flex-col gap-4 px-[clamp(16px,3vw,36px)] pb-10 pt-6">{children}</main>
    </div>
  );
}
