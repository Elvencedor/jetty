import type { Metadata } from "next";
import { Suspense } from "react";
import { Checkout } from "@/components/checkout/Checkout";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <div className="px-4 pt-4">
      <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-xl" />}>
        <Checkout />
      </Suspense>
    </div>
  );
}
