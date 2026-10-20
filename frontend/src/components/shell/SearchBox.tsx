"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { getSuggestions } from "@/lib/api/catalog";
import { isOptimisable } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDebounced } from "./useDebounced";

const MIN_CHARS = 2;

/** Header search with type-ahead. Enter searches the text; arrow keys move through suggestions (a combobox). */
export function SearchBox({ className, initial = "" }: { className?: string; initial?: string }) {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const term = useDebounced(text.trim(), 200);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["suggestions", term.toLowerCase()],
    queryFn: ({ signal }) => getSuggestions(term, { signal }),
    enabled: term.length >= MIN_CHARS,
    staleTime: 60_000,
  });
  const showList = open && text.trim().length >= MIN_CHARS && suggestions.length > 0;

  const go = (href: string) => {
    setOpen(false);
    setActive(-1);
    input.current?.blur();
    router.push(href);
  };
  const submit = () => {
    const q = text.trim();
    if (q) go(`/search?q=${encodeURIComponent(q)}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && showList) {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && showList) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = showList ? suggestions[active] : undefined;
      if (chosen) go(`/p/${chosen.slug}`);
      else submit();
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className={cn("relative", className)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex h-11 items-center gap-2 rounded-pill bg-surface-tint px-4 focus-within:outline-2 focus-within:outline-primary">
        <Search aria-hidden="true" size={18} className="shrink-0 text-muted" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search wigs"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          maxLength={100}
          placeholder="Search wigs, textures, lengths"
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-body-sm text-ink outline-none placeholder:text-muted"
        />
      </form>
      <ul id={listId} role="listbox" aria-label="Suggestions" hidden={!showList} className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-line bg-surface shadow-panel">
        {suggestions.map((s, i) => (
          <li key={s.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
            <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => go(`/p/${s.slug}`)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-body-sm", i === active ? "bg-surface-tint" : "hover:bg-surface-subtle")}>
              <span className="relative size-10 shrink-0 overflow-hidden rounded-sm bg-photo-1">
                {s.image?.url ? <Image src={s.image.url} alt="" fill sizes="40px" unoptimized={!isOptimisable(s.image.url)} className="object-cover" /> : null}
              </span>
              <span className="line-clamp-2 font-semibold text-ink">{s.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
