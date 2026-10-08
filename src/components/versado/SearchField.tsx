"use client";

import { useId, useRef } from "react";
import { Search, X } from "lucide-react";
import { focusRing } from "@/components/versado/styles";

/**
 * Het zoekveld van de hulpmiddelen. type="search" met zoek-toets op het
 * schermtoetsenbord, geen automatische hoofdletters of correcties (het gaat om
 * letterlijke woorden en namen), een wisknop die het veld leegt en de focus
 * behoudt, en Escape om te wissen. Het veld heeft een vaste hoogte, dus de
 * pagina verspringt niet als het toetsenbord opent.
 */
export default function SearchField({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  clearLabel: string;
  className?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`relative ${className}`} role="search">
      <label htmlFor={id} className="sr-only">{label}</label>
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-vs-fg-3" aria-hidden />
      <input
        id={id}
        ref={inputRef}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        className={`h-12 w-full appearance-none rounded-2xl border border-vs-line-strong bg-vs-surface pl-12 pr-12 text-base text-vs-fg placeholder:text-vs-fg-3 [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
      />
      {value && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className={`absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-vs-fg-3 hover:bg-vs-subtle hover:text-vs-fg ${focusRing}`}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      )}
    </div>
  );
}
