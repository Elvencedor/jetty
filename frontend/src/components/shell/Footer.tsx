import Link from "next/link";
import type { StoreSettings } from "@/lib/api/types";

const SHOP = [
  { href: "/shop", label: "All wigs" },
  { href: "/shop?sort=newest", label: "New in" },
  { href: "/shop?onOffer=1", label: "Deals" },
  { href: "/saved", label: "Saved" },
];
const HELP = [
  { href: "/track", label: "Track an order" },
  { href: "/pages/delivery", label: "Delivery" },
  { href: "/pages/returns", label: "Returns" },
  { href: "/pages/faqs", label: "FAQs" },
  { href: "/pages/care-guide", label: "Care guide" },
];

/** Links and contact details. `settings` is null if the API could not be reached: the links still render. */
export function Footer({ settings }: { settings: StoreSettings | null }) {
  const store = settings?.store;
  const whatsapp = store?.whatsappNumber.replace(/\D/g, "");
  return (
    <footer className="mt-16 border-t border-line bg-surface-subtle pb-24 lg:pb-0">
      <div className="mx-auto grid max-w-store gap-8 px-4 py-10 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <p className="font-display text-heading-sm font-extrabold">{store?.name ?? "Jetty's Hair"}</p>
          <p className="text-body-sm text-muted">Premium wigs, delivered across Nigeria.</p>
          {store?.showroomAddress ? <p className="text-body-sm text-muted">{store.showroomAddress}{store.showroomHours ? ` · ${store.showroomHours}` : ""}</p> : null}
        </div>
        <nav aria-label="Shop" className="flex flex-col gap-2">
          <p className="text-label font-bold">Shop</p>
          {SHOP.map((l) => <Link key={l.href} href={l.href} className="text-body-sm text-muted hover:text-primary-strong">{l.label}</Link>)}
        </nav>
        <nav aria-label="Help" className="flex flex-col gap-2">
          <p className="text-label font-bold">Help</p>
          {HELP.map((l) => <Link key={l.href} href={l.href} className="text-body-sm text-muted hover:text-primary-strong">{l.label}</Link>)}
          {store?.contactPhone ? <a href={`tel:${store.contactPhone}`} className="text-body-sm text-muted hover:text-primary-strong">{store.contactPhone}</a> : null}
          {store?.contactEmail ? <a href={`mailto:${store.contactEmail}`} className="text-body-sm text-muted hover:text-primary-strong">{store.contactEmail}</a> : null}
          {whatsapp ? <a href={`https://wa.me/${whatsapp}`} rel="noopener noreferrer" className="text-body-sm text-muted hover:text-primary-strong">WhatsApp us</a> : null}
        </nav>
      </div>
      <p className="border-t border-line-soft px-4 py-4 text-center text-caption text-muted">&copy; {new Date().getFullYear()} {store?.name ?? "Jetty's Hair"}</p>
    </footer>
  );
}
