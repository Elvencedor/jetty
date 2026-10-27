import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PaymentFlow } from "@/components/checkout/PaymentFlow";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Flow({ searchParams }: Pick<PageProps<"/checkout/pay">, "searchParams">) {
  const order = (await searchParams).order;
  if (typeof order !== "string" || !UUID.test(order)) notFound();
  return <PaymentFlow orderId={order} />;
}

export default function PayPage(props: PageProps<"/checkout/pay">) {
  return (
    <div className="px-4">
      <Suspense fallback={<Skeleton className="mx-auto mt-6 h-64 w-full max-w-xl" />}>
        <Flow searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
