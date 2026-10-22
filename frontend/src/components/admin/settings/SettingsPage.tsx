"use client";

import { CreditCard, RotateCcw, Store, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { SETTINGS_SECTIONS, sectionByKey, type SettingsSectionKey } from "@/lib/admin/settings";
import { cn } from "@/lib/cn";
import { DeliverySection } from "./DeliverySection";
import { PaymentsForm, PoliciesForm, StoreFormCard } from "./SettingForms";
import { permits } from "@/lib/admin/permissions";
import { useAdminSession } from "@/lib/stores/session";

const ICONS: Record<SettingsSectionKey, LucideIcon> = { store: Store, delivery: Truck, payments: CreditCard, policies: RotateCcw };

/** Settings: a menu of sections beside the section's form. Only an owner can save; others read. */
export function SettingsPage({ section }: { section: string }) {
  const held = useAdminSession((s) => s.user?.permissions) ?? [];
  const canWrite = permits(held, "settings:write");
  const current = sectionByKey(section);

  return (
    <div className="flex flex-wrap items-start gap-[18px]">
      <aside aria-label="Settings sections" className="flex max-w-full flex-[1_1_240px] flex-col gap-1.5">
        <h1 className="mb-2 font-display text-display-md font-extrabold">Settings</h1>
        <nav aria-label="Settings" className="flex flex-col gap-1.5">
          {SETTINGS_SECTIONS.map((s) => {
            const on = s.key === current?.key;
            const Icon = ICONS[s.key];
            return (
              <Link key={s.key} href={`/admin/settings/${s.key}`} aria-current={on ? "page" : undefined} className={cn("flex min-h-14 items-center gap-3 rounded-[18px] px-3.5 py-2", on ? "bg-surface-inverse text-on-inverse" : "text-ink hover:bg-surface-tint")}>
                <span aria-hidden="true" className={cn("flex size-[34px] shrink-0 items-center justify-center rounded-[12px]", on ? "bg-primary text-on-primary" : "bg-surface-blush text-primary-strong")}><Icon size={18} strokeWidth={2} /></span>
                <span className="flex flex-col leading-[1.25]"><span className="font-bold">{s.label}</span><span className={cn("text-caption", on ? "text-on-inverse-muted" : "text-muted")}>{s.note}</span></span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-3.5">
        {!canWrite ? <p className="rounded-lg bg-info-bg px-4 py-2.5 text-body-sm text-info">You can look at these settings, but only an owner can change them.</p> : null}
        {current?.key === "store" ? <StoreFormCard canWrite={canWrite} /> : current?.key === "delivery" ? <DeliverySection canWrite={canWrite} /> : current?.key === "payments" ? <PaymentsForm canWrite={canWrite} /> : current?.key === "policies" ? <PoliciesForm canWrite={canWrite} /> : (
          <EmptyState title="That settings page doesn't exist">Choose one from the menu.</EmptyState>
        )}
      </div>
    </div>
  );
}
