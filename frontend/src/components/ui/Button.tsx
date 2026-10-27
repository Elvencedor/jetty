import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "dark" | "outline" | "soft" | "danger-soft" | "add" | "ghost-link";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-pink-700",
  dark: "bg-surface-inverse text-on-inverse hover:bg-surface-inverse-raised",
  outline: "border-2 border-ink bg-surface text-ink hover:bg-surface-tint",
  soft: "bg-surface-tint text-primary-strong hover:bg-surface-blush",
  "danger-soft": "bg-danger-bg text-danger hover:brightness-95",
  add: "border-[1.5px] border-dashed border-line-accent bg-transparent text-primary-strong hover:bg-surface-tint",
  "ghost-link": "bg-transparent text-ink underline underline-offset-2 hover:text-primary-strong",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-label font-semibold",
  md: "h-11 px-4 text-body-sm font-semibold",
  lg: "h-14 px-6 text-body-lg font-bold",
};

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  /** Replaces the label with a spinner, keeps the width, and sets `aria-busy`. */
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
};

type AsButton = Common & { href?: undefined; ref?: Ref<HTMLButtonElement> } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;
type AsLink = Common & { href: string; ref?: Ref<HTMLAnchorElement> } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href">;
export type ButtonProps = AsButton | AsLink;

/** Pill button. Pass `href` and it renders a real link (same look), so navigation is never a `<button>`. */
export function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", iconLeft, iconRight, loading = false, fullWidth = false, children, className, ...rest } = props;
  const classes = cn(
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill transition-[background-color,transform,filter] duration-(--duration-fast) ease-standard active:scale-[0.98]",
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    className,
  );
  const content = (
    <>
      {/* The label stays in the layout while loading so the button does not change width. */}
      <span className={cn("inline-flex items-center justify-center gap-2", loading && "invisible")}>
        {iconLeft}
        {children}
        {iconRight}
      </span>
      {loading && <Spinner className="absolute" />}
    </>
  );

  if (props.href !== undefined) {
    const { href, ref, ...anchor } = rest as Omit<AsLink, keyof Common | "className">;
    return (
      <Link href={href} ref={ref} className={classes} aria-busy={loading || undefined} {...anchor}>
        {content}
      </Link>
    );
  }
  const { ref, disabled, type = "button", ...button } = rest as Omit<AsButton, keyof Common | "className">;
  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...button}>
      {content}
    </button>
  );
}
