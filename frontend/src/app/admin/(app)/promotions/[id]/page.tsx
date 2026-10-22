import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { PromotionBuilder } from "@/components/admin/promotions/PromotionBuilder";

export const metadata: Metadata = { title: "Promotion" };

export default async function AdminPromotionPage({ params }: PageProps<"/admin/promotions/[id]">) {
  const { id } = await params;
  return (
    <PermissionGate section="promotions">
      <PromotionBuilder id={id} />
    </PermissionGate>
  );
}
