"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { HymnIndexEntry } from "@/lib/hymns/types";
import { prepareIndex, searchHymns } from "@/lib/hymns/search";
import { focusRing } from "@/components/versado/styles";
import { COPY } from "./copy";

// De bibliotheeklijst met lokaal zoeken (nummer, titel, deel van de titel, eerste regel). Alleen nummer en titel staan in
// de rijen: geen technische labels. Zoeken gebeurt volledig op het toestel, zonder verzoek per toetsaanslag.
// content-visibility houdt de lijst vlot met honderden rijen.

interface Props {
  entries: HymnIndexEntry[];
  selected: number | null;
  loadingNumber: number | null;
  onSelect(number: number): void;
  autoFocus?: boolean;
}

export default function HymnList({ entries, selected, loadingNumber, onSelect, autoFocus = false }: Props) {
  const [query, setQuery] = useState("");
  const prepared = useMemo(() => prepareIndex(entries), [entries]);
  const results = useMemo(() => searchHymns(prepared, query), [prepared, query]);
  return (
    <div className="space-y-3" data-hymns-list>
      <label className="relative block">
        <span className="sr-only">{COPY.searchLabel}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-vs-fg-3" aria-hidden="true" />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          data-hymns-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={COPY.searchPlaceholder}
          className={`min-h-12 w-full min-w-0 rounded-2xl border border-vs-line-strong bg-vs-surface pl-10 pr-3 text-base text-vs-fg placeholder:text-vs-fg-3 ${focusRing}`}
        />
      </label>
      {results.length === 0 ? (
        <p className="text-base text-vs-fg-2" role="status" data-hymns-no-results>
          {COPY.searchNone}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label={COPY.hymnLabel}>
          {results.map((h) => {
            const on = h.number === selected;
            return (
              <li key={h.number} className="[content-visibility:auto] [contain-intrinsic-size:auto_3.25rem]">
                <button
                  type="button"
                  data-hymn-number={h.number}
                  aria-current={on ? "true" : undefined}
                  aria-busy={loadingNumber === h.number ? "true" : undefined}
                  onClick={() => onSelect(h.number)}
                  className={`vs-motion flex min-h-12 w-full items-center gap-3 rounded-2xl border px-4 py-2 text-left ${focusRing} ${
                    on ? "border-vs-accent bg-vs-accent-soft text-vs-fg" : "border-vs-line bg-vs-surface text-vs-fg-2"
                  }`}
                >
                  <span className="w-9 shrink-0 text-lg font-bold tabular-nums text-vs-fg">{h.number}</span>
                  <span className="vs-wrap min-w-0 flex-1 text-base font-semibold">{h.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
