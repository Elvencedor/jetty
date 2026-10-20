import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Confirmation } from "@/components/order/Confirmation";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Order confirmed", robots: { index: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Content({ params }: Pick<PageProps<"/order/[orderId]/confirmed">, "params">) {
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();
  return <Confirmation orderId={orderId} />;
}

export default function ConfirmedPage(props: PageProps<"/order/[orderId]/confirmed">) {
  return (
    <div className="px-4">
      <Suspense fallback={<Skeleton className="mx-auto h-72 w-full max-w-xl" />}>
        <Content params={props.params} />
      </Suspense>
    </div>
  );
}
