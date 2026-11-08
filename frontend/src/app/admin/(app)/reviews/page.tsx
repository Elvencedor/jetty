import type { Metadata } from "next";
import { Suspense } from "react";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { ReviewsPage } from "@/components/admin/reviews/ReviewsPage";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Reviews" };

// Rendered only once the browser confirms an admin session (AdminGate), so there is nothing for Next to validate.
export const instant = false;

export default function AdminReviewsPage() {
  return (
    <PermissionGate section="reviews">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ReviewsPage />
      </Suspense>
    </PermissionGate>
  );
}
