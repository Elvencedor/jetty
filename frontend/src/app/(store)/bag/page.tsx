import type { Metadata } from "next";
import { Bag } from "@/components/bag/Bag";

export const metadata: Metadata = { title: "My bag", robots: { index: false } };

export default function BagPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Bag />
    </div>
  );
}
