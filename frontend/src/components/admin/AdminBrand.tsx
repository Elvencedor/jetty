import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The brand logo with a small "Admin" tag beside it, so anyone looking at a screen can tell it is the admin side of the shop
 * and not the storefront. Used in the top bar and on the sign-in page. `light` is for a dark background.
 */
export function AdminBrand({ size = "md", light = false, className }: { size?: "md" | "lg"; light?: boolean; className?: string }) {
  const lg = size === "lg";
  return (
    <span className={cn("inline-flex items-center", lg ? "gap-3" : "gap-2.5", className)}>
      {light ? (
        <Image src="/brand/jettys-hairs-monochrome-white.png" alt="Jetty's Hairs" width={1024} height={1024} priority className={cn("w-auto", lg ? "h-36" : "h-14")} />
      ) : (
        <Image src="/brand/jettys-hairs-transparent.png" alt="Jetty's Hairs" width={712} height={754} priority className={cn("w-auto", lg ? "h-28" : "h-14")} />
      )}
      <span aria-hidden="true" className={cn("w-px self-stretch", light ? "bg-white/25" : "bg-line-strong", lg ? "my-4" : "my-2")} />
      <span className={cn("rounded-pill font-extrabold uppercase tracking-[0.14em]", lg ? "px-3.5 py-1.5 text-body-sm" : "px-3 py-1 text-caption", light ? "bg-white/15 text-white" : "bg-surface-inverse text-on-inverse")}>Admin</span>
    </span>
  );
}
