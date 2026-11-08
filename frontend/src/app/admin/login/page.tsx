import type { Metadata } from "next";
import { Package, ShoppingBag, Tag, Truck } from "lucide-react";
import { Suspense } from "react";
import { AdminBrand } from "@/components/admin/AdminBrand";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export const metadata: Metadata = { title: "Sign in" };

const AREAS = [
  { icon: ShoppingBag, text: "Orders, payments and refunds" },
  { icon: Package, text: "Products, variants and stock" },
  { icon: Tag, text: "Promotions and the storefront" },
  { icon: Truck, text: "Delivery zones and settings" },
];

/** A split sign-in page: the brand and what the admin is for on one side, the form on the other (the form alone on a phone). */
export default function AdminLoginPage() {
  return (
    <main id="main" className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-surface-inverse p-12 text-on-inverse lg:flex">
        {/* Soft shapes in the brand pink, behind everything. */}
        <span aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 size-[420px] rounded-full bg-primary/25 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-24 size-[380px] rounded-full bg-primary/15 blur-3xl" />
        <AdminBrand size="lg" light className="relative" />
        <div className="relative flex max-w-md flex-col gap-6">
          <h2 className="font-display text-heading-lg font-extrabold leading-tight">Run the shop from one place.</h2>
          <ul className="flex flex-col gap-3.5">
            {AREAS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-body">
                <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10"><Icon size={18} /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-caption text-white/60">Jetty&apos;s Hairs admin. For authorised staff only.</p>
      </aside>
      <section className="flex items-center justify-center bg-surface-subtle p-6 lg:bg-surface">
        <Suspense fallback={null}>
          <AdminLoginForm />
        </Suspense>
      </section>
    </main>
  );
}
