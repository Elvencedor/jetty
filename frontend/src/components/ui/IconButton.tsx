import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

export type IconButtonVariant = "on-white" | "on-tint" | "on-image" | "inverse";

const VARIANTS: Record<IconButtonVariant, string> = {
  "on-white": "bg-surface-tint text-ink hover:bg-surface-blush",
  "on-tint": "bg-surface text-ink hover:bg-surface-blush",
  "on-image": "bg-white text-ink shadow-sm hover:bg-surface-tint",
  inverse: "bg-white/20 text-on-primary hover:bg-white/30",
};

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  /** Count shown in a small circle at the top right (the bag). Hidden at zero. */
  badge?: number;
  ref?: Ref<HTMLButtonElement>;
};

/** 44×44 circular icon button (the minimum touch target). */
export function IconButton({ label, icon, variant = "on-white", badge, className, type = "button", ...rest }: Props) {
  // The visible badge and the accessible name must say the same thing ("99+" is shown, so "99+" is spoken).
  const count = badge ? (badge > 99 ? "99+" : String(badge)) : null;
  return (
    <button
      type={type}
      aria-label={count ? `${label}, ${count} ${badge === 1 ? "item" : "items"}` : label}
      className={cn("relative inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-(--duration-fast) ease-standard active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50", VARIANTS[variant], className)}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
      {badge ? (
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex size-[18px] items-center justify-center rounded-full bg-primary text-micro font-bold text-on-primary ring-2 ring-white">
          {count}
        </span>
      ) : null}
    </button>
  );
}
