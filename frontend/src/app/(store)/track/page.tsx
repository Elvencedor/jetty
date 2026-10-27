import type { Metadata } from "next";
import { TrackForm } from "@/components/order/TrackForm";

export const metadata: Metadata = { title: "Track an order", robots: { index: false } };

export default function TrackPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">
      <h1 className="font-display text-heading-lg font-extrabold">Track an order</h1>
      <p className="text-body text-ink-soft">Enter your order number and the phone number you used to order.</p>
      <TrackForm />
    </div>
  );
}
