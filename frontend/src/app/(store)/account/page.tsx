import type { Metadata } from "next";
import { AccountHome } from "@/components/account/AccountHome";

export const metadata: Metadata = { title: "Me", robots: { index: false } };

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4">
      <AccountHome />
    </div>
  );
}
