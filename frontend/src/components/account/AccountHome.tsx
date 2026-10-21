"use client";

import { ChevronRight, Heart, LogOut, PackageSearch, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { signOut } from "@/lib/api/account";
import { formatPhone } from "@/lib/format";
import { useCustomerSession } from "@/lib/stores/session";

const LINKS = [
  { href: "/account/orders", label: "My orders", icon: ShoppingBag },
  { href: "/saved", label: "Saved wigs", icon: Heart },
  { href: "/track", label: "Track an order", icon: PackageSearch },
];

/** The "Me" tab: sign-in prompt for guests, profile and links for customers. */
export function AccountHome() {
  const status = useCustomerSession((s) => s.status);
  const user = useCustomerSession((s) => s.user);
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  if (status === "unknown") return <Skeleton className="h-48 w-full" />;

  if (status === "anonymous") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-heading-lg font-extrabold">Me</h1>
        <div className="flex flex-col gap-3 rounded-lg bg-surface-tint p-5">
          <p className="font-bold">Sign in to see your orders and check out faster.</p>
          <p className="text-body-sm text-ink-soft">You don&apos;t need an account to buy: guests can check out and track orders too.</p>
          <div className="flex flex-wrap gap-3">
            <Button href="/account/sign-in">Sign in</Button>
            <Button href="/account/sign-in?mode=register" variant="outline">Create account</Button>
          </div>
        </div>
        <ul className="flex flex-col">{LINKS.filter((l) => l.href !== "/account/orders").map((l) => <NavRow key={l.href} {...l} />)}</ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-heading-lg font-extrabold">Me</h1>
      <section aria-label="Your details" className="rounded-lg bg-surface-tint p-4 text-body-sm">
        <p className="font-bold">{user?.phone ? formatPhone(user.phone) : user?.email}</p>
        {user?.phone && user.email ? <p className="text-ink-soft">{user.email}</p> : null}
      </section>
      <ul className="flex flex-col">{LINKS.map((l) => <NavRow key={l.href} {...l} />)}</ul>
      <Button
        variant="outline"
        iconLeft={<LogOut aria-hidden="true" size={18} />}
        loading={leaving}
        onClick={async () => {
          setLeaving(true);
          await signOut();
          router.replace("/");
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

function NavRow({ href, label, icon: Icon }: (typeof LINKS)[number]) {
  return (
    <li className="border-b border-line-soft">
      <Link href={href} className="flex min-h-14 items-center gap-3">
        <Icon aria-hidden="true" size={20} className="text-primary-strong" />
        <span className="flex-1 text-body font-semibold">{label}</span>
        <ChevronRight aria-hidden="true" size={18} className="text-muted" />
      </Link>
    </li>
  );
}
