import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { SITE_NAME } from "@/lib/site";

/** The brand logo, linking home. `className` sizes the picture (the artwork is 712×754, so size it by height). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className="flex shrink-0 items-center">
      <Image src="/brand/jettys-hairs-transparent.png" alt={SITE_NAME} width={712} height={754} priority className={cn("h-16 w-auto lg:h-20", className)} />
    </Link>
  );
}
