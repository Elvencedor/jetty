import type { Metadata } from "next";
import { PermissionGate } from "@/components/admin/PermissionGate";
import { PromotionBuilder } from "@/components/admin/promotions/PromotionBuilder";

export const metadata: Metadata = { title: "New promotion" };

export default function AdminNewPromotionPage() {
  return (
    <PermissionGate section="promotions">
      <PromotionBuilder />
    </PermissionGate>
  );
}
