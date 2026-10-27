import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReturnHandler } from "@/components/checkout/ReturnHandler";

export const metadata: Metadata = { title: "Confirming payment", robots: { index: false } };

async function Handler({ searchParams }: Pick<PageProps<"/checkout/return">, "searchParams">) {
  const q = await searchParams;
  const reference = [q.reference, q.trxref].find((v): v is string => typeof v === "string");
  if (!reference || reference.length > 100 || !/^[A-Za-z0-9._-]+$/.test(reference)) notFound();
  return <ReturnHandler reference={reference} />;
}

export default function ReturnPage(props: PageProps<"/checkout/return">) {
  return (
    <div className="px-4">
      <Suspense fallback={null}>
        <Handler searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
