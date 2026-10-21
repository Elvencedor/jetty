import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPanel } from "@/components/account/AuthPanel";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function SignInPage() {
  return (
    <div className="px-4 pt-6">
      <Suspense fallback={<Skeleton className="mx-auto h-80 w-full max-w-md" />}>
        <AuthPanel />
      </Suspense>
    </div>
  );
}
