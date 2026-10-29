"use client";

import { Check, ChevronDown } from "lucide-react";
import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/cn";

type Choice = { value: string; label: ReactNode; text: string; disabled: boolean };

/** What `onChange` receives: just enough of a change event for `e.target.value`, so native `<select>` call sites carry over. */
export type DropdownChange = { target: { value: string } };

export type DropdownProps = {
  value: string | number;
  onChange?: ((e: DropdownChange) => void) | undefined;
  /** `<option>` elements, as for a native select. */
  children: ReactNode;
  id?: string | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
  /** Classes for the trigger button (size, border, radius). */
  className?: string | undefined;
  /** Classes for the open list. */
  menuClassName?: string | undefined;
  ref?: Ref<HTMLButtonElement>;
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  "aria-invalid"?: boolean | undefined;
  "aria-describedby"?: string | undefined;
};

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function collect(children: ReactNode, into: Choice[] = []): Choice[] {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) continue;
    if (child.type === Fragment) collect(child.props.children, into);
    else if (child.type === "option") {
      const text = textOf(child.props.children);
      into.push({ value: child.props.value != null ? String(child.props.value) : text, label: child.props.children, text, disabled: Boolean(child.props.disabled) });
    }
  }
  return into;
}

const MENU_MAX = 288;
const hasPopover = () => typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

/**
 * An accessible select-only combobox: a button that opens a listbox. Keyboard: arrows, Home/End, Enter/Space,
 * Escape and type-ahead. The list lives in the browser's top layer (Popover API), so it is neither clipped by
 * scrolling drawers nor hidden behind a modal `<dialog>`.
 */
export function Dropdown({ value, onChange, children, id: given, name, disabled, className, menuClassName, ref, ...aria }: DropdownProps) {
  const auto = useId();
  const id = given ?? auto;
  const listId = `${id}-list`;
  const choices = collect(children);
  const current = String(value);
  const selected = choices.find((c) => c.value === current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const enabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < choices.length; i += step) if (!choices[i]!.disabled) return i;
    return -1;
  };

  function show() {
    if (disabled || choices.length === 0) return;
    const at = choices.findIndex((c) => c.value === current && !c.disabled);
    setActive(at >= 0 ? at : Math.max(enabled(0, 1), 0));
    setOpen(true);
  }

  function pick(index: number) {
    const choice = choices[index];
    if (!choice || choice.disabled) return;
    setOpen(false);
    if (choice.value !== current) onChange?.({ target: { value: choice.value } });
  }

  // Place the list under the trigger, or above it when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const below = window.innerHeight - box.bottom;
      const height = Math.min(MENU_MAX, choices.length * 44 + 8);
      const flip = below < height + 8 && box.top > below;
      setPlace({
        position: "fixed",
        inset: "auto",
        margin: 0,
        left: Math.max(8, Math.min(box.left, window.innerWidth - Math.max(box.width, 160) - 8)),
        minWidth: box.width,
        maxHeight: Math.max(120, Math.min(MENU_MAX, (flip ? box.top : below) - 12)),
        ...(flip ? { bottom: window.innerHeight - box.top + 4 } : { top: box.bottom + 4 }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, choices.length]);

  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el) return;
    if (typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover();
    return () => {
      if (typeof el.hidePopover === "function" && el.matches(":popover-open")) el.hidePopover();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const last = choices.length - 1;
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((a) => (enabled(a + 1, 1) >= 0 ? enabled(a + 1, 1) : a)); return;
      case "ArrowUp": e.preventDefault(); setActive((a) => (enabled(a - 1, -1) >= 0 ? enabled(a - 1, -1) : a)); return;
      case "Home": e.preventDefault(); setActive(Math.max(enabled(0, 1), 0)); return;
      case "End": e.preventDefault(); setActive(Math.max(enabled(last, -1), 0)); return;
      case "Enter":
      case " ": e.preventDefault(); pick(active); return;
      case "Escape": e.preventDefault(); e.stopPropagation(); setOpen(false); return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typed.current;
      t.text = (now - t.at > 700 ? "" : t.text) + e.key.toLowerCase();
      t.at = now;
      const from = t.text.length === 1 ? active + 1 : active;
      const hit = [...choices.keys()].map((i) => (i + from) % choices.length).find((i) => !choices[i]!.disabled && choices[i]!.text.toLowerCase().startsWith(t.text));
      if (hit !== undefined) setActive(hit);
    }
  }

  return (
    <>
      <button
        ref={(node) => {
          trigger.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className={cn("flex items-center justify-between gap-2 text-left", className)}
        {...aria}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? ""}</span>
        <ChevronDown aria-hidden="true" className={cn("size-5 shrink-0 text-muted transition-transform duration-(--duration-fast)", open && "rotate-180")} />
      </button>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          popover={hasPopover() ? "manual" : undefined}
          aria-labelledby={aria["aria-labelledby"]}
          aria-label={aria["aria-label"]}
          style={place}
          // Keep focus on the trigger while the pointer works the list.
          onMouseDown={(e) => e.preventDefault()}
          className={cn("z-50 m-0 overflow-y-auto overscroll-contain rounded-md border border-line bg-surface p-1 text-ink shadow-lg", menuClassName)}
        >
          {choices.map((c, i) => (
            <li
              key={c.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={c.value === current}
              aria-disabled={c.disabled || undefined}
              onPointerMove={() => !c.disabled && setActive(i)}
              onClick={() => pick(i)}
              className={cn(
                "flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 text-body-sm",
                i === active && "bg-surface-tint",
                c.value === current && "font-semibold text-primary-strong",
                c.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="min-w-0 flex-1">{c.label}</span>
              {c.value === current ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
