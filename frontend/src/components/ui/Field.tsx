import { ChevronDown, Search } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type FieldBase = {
  label: string;
  hint?: string;
  /** Message shown under the field. Its presence marks the field invalid. */
  error?: string | undefined;
  /** `store` is the 52px customer field; `admin` is 44px. */
  size?: "store" | "admin";
};

const SIZE = { store: "min-h-[52px]", admin: "min-h-11" } as const;
const CONTROL =
  "w-full rounded-md border-[1.5px] bg-surface px-4 text-body text-ink placeholder:text-muted/70 transition-colors duration-(--duration-fast) focus:border-primary focus:outline-2 focus:outline-offset-0 focus:outline-primary/30 disabled:cursor-not-allowed disabled:opacity-50";

function Shell({ id, label, hint, error, children }: { id: string; label: string; hint?: string | undefined; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-caption font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);
const borderFor = (error?: string) => (error ? "border-danger" : "border-line-strong");

export type TextFieldProps = FieldBase & {
  /** Text inside the field before the value, e.g. "₦" or "±". */
  prefix?: string;
  ref?: Ref<HTMLInputElement>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix">;

export function TextField({ label, hint, error, size = "store", prefix, className, id: given, ref, ...input }: TextFieldProps) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        {prefix ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-body text-muted">{prefix}</span> : null}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(CONTROL, SIZE[size], borderFor(error), prefix && "pl-9", className)}
          {...input}
        />
      </div>
    </Shell>
  );
}

export type TextareaFieldProps = FieldBase & { ref?: Ref<HTMLTextAreaElement> } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size">;

export function TextareaField({ label, hint, error, size = "store", className, id: given, rows = 4, ref, ...textarea }: TextareaFieldProps) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(CONTROL, SIZE[size], borderFor(error), "py-3", className)}
        {...textarea}
      />
    </Shell>
  );
}

export type SelectFieldProps = FieldBase & { ref?: Ref<HTMLSelectElement>; children: ReactNode } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">;

export function SelectField({ label, hint, error, size = "store", className, id: given, children, ref, ...select }: SelectFieldProps) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(CONTROL, SIZE[size], borderFor(error), "appearance-none pr-11", className)}
          {...select}
        >
          {children}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
      </div>
    </Shell>
  );
}

/** Pill search input with a leading icon. The visible label is supplied as `aria-label`. */
export function SearchField({ className, ref, ...input }: { ref?: Ref<HTMLInputElement> } & Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { "aria-label": string }) {
  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        className="h-[50px] w-full rounded-pill bg-surface-tint pl-12 pr-4 text-body text-ink placeholder:text-muted/70 focus:outline-2 focus:outline-offset-0 focus:outline-primary/40 [&::-webkit-search-cancel-button]:appearance-none"
        {...input}
      />
    </div>
  );
}
