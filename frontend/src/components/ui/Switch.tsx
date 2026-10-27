"use client";

import { cn } from "@/lib/cn";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; describe what is switched ("Show hero cards"), not the state. */
  label: string;
  disabled?: boolean;
  className?: string;
};

/** 44×26 toggle. Exposed as `role="switch"`, so assistive technology announces on/off. */
export function Switch({ checked, onChange, label, disabled, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-[26px] w-11 shrink-0 items-center rounded-pill transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50", checked ? "bg-primary" : "bg-line-strong", className)}
    >
      <span aria-hidden="true" className={cn("absolute left-[3px] size-5 rounded-full bg-white shadow-sm transition-transform duration-(--duration-fast) ease-standard", checked && "translate-x-[18px]")} />
    </button>
  );
}
