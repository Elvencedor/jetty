import type { Metadata } from "next";
import { Bag } from "@/components/bag/Bag";

export const metadata: Metadata = { title: "My bag", robots: { index: false } };

export default function BagPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4 lg:max-w-store">
      <Bag />
    </div>
  );
}
