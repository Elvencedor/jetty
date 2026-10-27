import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderHistory } from "@/components/account/OrderHistory";
import { RequireCustomer } from "@/components/account/RequireCustomer";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "My orders", robots: { index: false } };

export default function OrdersPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">
      <h1 className="font-display text-heading-lg font-extrabold">My orders</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <RequireCustomer>
          <OrderHistory />
        </RequireCustomer>
      </Suspense>
    </div>
  );
}
