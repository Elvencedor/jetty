import type { Metadata } from "next";
import { SavedList } from "@/components/catalog/SavedList";

export const metadata: Metadata = { title: "Saved wigs", robots: { index: false } };

export default function SavedPage() {
  return (
    <div className="mx-auto flex w-full max-w-store flex-col gap-4 px-4 pt-4">
      <h1 className="font-display text-heading-lg font-extrabold">Saved wigs</h1>
      <SavedList />
    </div>
  );
}
