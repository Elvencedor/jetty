import { X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ChipVariant = "choice" | "choice-soft" | "removable" | "static";

type Props = {
  variant?: ChipVariant;
  selected?: boolean;
  /** Second line, e.g. "+₦25k" or "Included". */
  note?: string;
  children: ReactNode;
  /** The chip is the main control on a mobile screen: 44px instead of 36px. */
  large?: boolean;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">;

const BASE = "inline-flex items-center justify-center gap-1.5 rounded-pill px-4 text-label font-semibold transition-colors duration-(--duration-base) ease-standard";

/**
 * Selectable chip. Selected is shown by fill and text colour, never by hue alone. A disabled `choice` chip reads as
 * sold out (struck through); give it an `aria-label` that says so ("20 inches, sold out"). Any `aria-label` must
 * contain the visible text in order, or screen-reader users who say what they see will not be understood; for a
 * chip with a `note` that means leaving the label off and letting the visible text speak for itself.
 */
export function Chip({ variant = "choice", selected = false, note, children, large = false, className, disabled, ...rest }: Props) {
  const height = large ? "min-h-11" : "min-h-9";
  const label = (
    <span className="flex flex-col items-center leading-tight">
      <span className={cn(disabled && variant === "choice" && "line-through")}>{children}</span>
      {note ? <span className={cn("text-caption font-medium", selected ? "text-on-primary" : "text-muted")}>{note}</span> : null}
    </span>
  );

  if (variant === "static") {
    return <span className={cn(BASE, height, "bg-surface-tint font-medium text-ink", className)}>{label}</span>;
  }
  if (variant === "removable") {
    return (
      <button type="button" className={cn(BASE, height, "bg-surface-tint pr-3 text-ink hover:bg-surface-blush", className)} {...rest}>
        {label}
        <X aria-hidden="true" className="size-4" />
      </button>
    );
  }
  const states =
    variant === "choice"
      ? selected
        ? "border-[1.5px] border-primary bg-primary text-on-primary"
        : "border-[1.5px] border-line-strong bg-surface text-ink hover:bg-surface-tint"
      : selected
        ? "border-[1.5px] border-primary bg-surface-tint text-primary-strong"
        : "border-[1.5px] border-line-strong bg-surface text-ink hover:bg-surface-tint";
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={cn(BASE, height, states, disabled && "cursor-not-allowed border-line bg-surface text-faint hover:bg-surface", className)}
      {...rest}
    >
      {label}
    </button>
  );
}
