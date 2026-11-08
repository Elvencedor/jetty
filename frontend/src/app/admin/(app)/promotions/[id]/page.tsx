import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { PromotionBuilder } from "@/components/admin/promotions/PromotionBuilder";

export const metadata: Metadata = { title: "Promotion" };

// Rendered only once the browser confirms an admin session (AdminGate), so there is nothing for Next to validate.
export const instant = false;

export default async function AdminPromotionPage({ params }: PageProps<"/admin/promotions/[id]">) {
  const { id } = await params;
  return (
    <PermissionGate section="promotions">
      <PromotionBuilder id={id} />
    </PermissionGate>
  );
}
