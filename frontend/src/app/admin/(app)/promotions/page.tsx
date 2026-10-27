import type { Metadata } from "next";
import { Suspense } from "react";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { PromotionsPage } from "@/components/admin/promotions/PromotionsPage";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Promotions" };

export default function AdminPromotionsPage() {
  return (
    <PermissionGate section="promotions">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <PromotionsPage />
      </Suspense>
    </PermissionGate>
  );
}
