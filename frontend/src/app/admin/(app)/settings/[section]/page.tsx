import type { Metadata } from "next";
import { Suspense } from "react";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { SettingsPage } from "@/components/admin/settings/SettingsPage";
import { Skeleton } from "@/components/ui";
import { SETTINGS_SECTIONS, sectionByKey } from "@/lib/admin/settings";

export const generateStaticParams = () => SETTINGS_SECTIONS.map((s) => ({ section: s.key }));

export async function generateMetadata({ params }: PageProps<"/admin/settings/[section]">): Promise<Metadata> {
  const { section } = await params;
  return { title: sectionByKey(section)?.label ?? "Settings" };
}

export default async function AdminSettingsPage({ params }: PageProps<"/admin/settings/[section]">) {
  const { section } = await params;
  return (
    <PermissionGate section="settings">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SettingsPage section={section} />
      </Suspense>
    </PermissionGate>
  );
}
