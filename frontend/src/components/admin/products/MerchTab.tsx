"use client";

import { Dropdown } from "@/components/ui";
import { permits } from "@/lib/admin/permissions";
import { useAdminSession } from "@/lib/stores/session";
import { ProductPromotions } from "./ProductPromotions";
import type { Basics } from "@/lib/admin/productForm";

const BADGES = [{ value: "", label: "Auto (sale / BOGO / new)" }, { value: "Featured", label: "Featured" }, { value: "Best seller", label: "Best seller" }];

type Props = { productId: string; productTitle: string; basics: Basics; disabled: boolean; onChange: (patch: Partial<Basics>) => void };

/** How the product is promoted: the homepage star, the badge on its cards, and the promotions attached to it. */
export function MerchTab({ productId, productTitle, basics, disabled, onChange }: Props) {
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  // A badge typed in some other way (an older entry) is kept and shown rather than silently dropped.
  const custom = basics.badge && !BADGES.some((b) => b.value === basics.badge) ? [{ value: basics.badge, label: `Custom: ${basics.badge}` }] : [];
  return (
    <div className="flex flex-col gap-3 p-4">
      <label className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-surface-tint px-3.5 font-semibold">
        Feature on homepage
        <input type="checkbox" checked={basics.featured} disabled={disabled} onChange={(e) => onChange({ featured: e.target.checked })} className="size-5 accent-primary" />
      </label>
      <label className="flex flex-col gap-1 text-label font-semibold">
        Badge
        <Dropdown value={basics.badge} disabled={disabled} onChange={(e) => onChange({ badge: e.target.value })} className="h-[46px] rounded-md border-[1.5px] border-line-strong bg-surface px-3 text-body-sm font-normal">
          {[...BADGES, ...custom].map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </Dropdown>
        <span className="text-caption font-normal text-muted">Auto shows sale percentages, &ldquo;New&rdquo; and &ldquo;Low stock&rdquo; by itself.</span>
      </label>
      {permits(held, "promotions:read") ? <ProductPromotions productId={productId} productTitle={productTitle} canWrite={permits(held, "promotions:write") && !disabled} /> : null}
    </div>
  );
}
