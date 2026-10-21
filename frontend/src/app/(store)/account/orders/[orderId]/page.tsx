import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderDetailView } from "@/components/account/OrderDetailView";
import { RequireCustomer } from "@/components/account/RequireCustomer";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Order", robots: { index: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Content({ params }: Pick<PageProps<"/account/orders/[orderId]">, "params">) {
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  return (
    <RequireCustomer>
      <OrderDetailView orderId={orderId} />
    </RequireCustomer>
  );
}

export default function OrderPage(props: PageProps<"/account/orders/[orderId]">) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Content params={props.params} />
      </Suspense>
    </div>
  );
}
