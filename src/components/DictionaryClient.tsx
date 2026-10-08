"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchX } from "lucide-react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { useContentScope, useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { getLanguage } from "@/lib/languages";
import { searchWords, startLetters, wordsStartingWith, normalizeWord, type WordEntry } from "@/lib/dictionaryView";
import { useRecentWords } from "@/lib/useRecentWords";
import PageIntro from "@/components/versado/PageIntro";
import SearchField from "@/components/versado/SearchField";
import StateMessage from "@/components/versado/StateMessage";
import { focusRing, secondaryButton, surfaceCard } from "@/components/versado/styles";

interface DictionaryData {
  collectionName: string;
  entries: WordEntry[];
}

type FilterMode = "letter" | "length";
const PAGE_SIZE = 100;

export const dictionaryWordHref = (word: string) => `/tools/dictionary/${encodeURIComponent(word)}`;

/** De zoekstand staat in de URL (q, letter, lengte): terug vanuit een woord komt bij dezelfde lijst uit. */
function readUrlState(): { query: string; letter: string | null; length: number | null; mode: FilterMode } {
  if (typeof window === "undefined") return { query: "", letter: null, length: null, mode: "letter" };
  const params = new URLSearchParams(window.location.search);
  const length = Number(params.get("lengte"));
  return {
    query: params.get("q") ?? "",
    letter: params.get("letter"),
    length: Number.isInteger(length) && length > 0 ? length : null,
    mode: params.has("lengte") ? "length" : "letter",
  };
}

function writeUrlState(state: { query: string; letter: string | null; length: number | null; mode: FilterMode }) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  else if (state.mode === "letter" && state.letter) params.set("letter", state.letter);
  else if (state.mode === "length" && state.length !== null) params.set("lengte", String(state.length));
  const search = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}

/** Het deel van het woord dat overeenkomt met de zoekterm krijgt nadruk. */
function MatchedWord({ word, query }: { word: string; query: string }) {
  const q = normalizeWord(query);
  const at = q ? word.indexOf(q) : -1;
  if (at < 0) return <>{word}</>;
  return (
    <>
      {word.slice(0, at)}
      <span className="text-vs-accent">{word.slice(at, at + q.length)}</span>
      {word.slice(at + q.length)}
    </>
  );
}

export default function DictionaryClient() {
  const t = useT();
  const router = useRouter();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const scope = useContentScope();
  const dictionary = useLiveQuery<DictionaryData>(["dictionary", "entries"], () => fetchJson<DictionaryData>("/api/dictionary"), {
    scopes: ["content"],
    contentScoped: true,
    // Een woordenlijst verandert alleen met de content; lang vers houden voorkomt een flits bij terugkeren uit een woord.
    staleTime: 10 * 60_000,
  });
  const recent = useRecentWords(scope?.collectionId ?? "");

  const [initial] = useState(readUrlState);
  const [query, setQuery] = useState(initial.query);
  const [mode, setMode] = useState<FilterMode>(initial.mode);
  const [letter, setLetter] = useState<string | null>(initial.letter);
  const [length, setLength] = useState<number | null>(initial.length);
  const [shown, setShown] = useState({ signature: "", count: PAGE_SIZE });

  const entries = dictionary.data?.entries;
  const letters = useMemo(() => (entries ? startLetters(entries, intlLocale) : []), [entries, intlLocale]);
  const lengths = useMemo(() => (entries ? Array.from(new Set(entries.map((entry) => entry.word.length))).sort((a, b) => a - b) : []), [entries]);

  // Zonder zoekterm of keuze: de eerste letter, zodat de lijst nooit duizenden woorden tegelijk toont.
  const activeLetter = letter && letters.includes(letter) ? letter : letters[0] ?? null;
  const filtered = useMemo(() => {
    if (!entries) return [];
    if (query.trim()) return searchWords(entries, query);
    if (mode === "length") return length !== null ? entries.filter((entry) => entry.word.length === length) : entries;
    return activeLetter ? wordsStartingWith(entries, activeLetter) : entries;
  }, [entries, query, mode, length, activeLetter]);

  const signature = `${query}|${mode}|${activeLetter}|${length}`;
  const visibleCount = shown.signature === signature ? shown.count : PAGE_SIZE;
  const visible = filtered.slice(0, visibleCount);
  const searching = query.trim().length > 0;

  function update(next: { query?: string; mode?: FilterMode; letter?: string | null; length?: number | null }) {
    const state = { query, mode, letter: activeLetter, length, ...next };
    if (next.query !== undefined) setQuery(next.query);
    if (next.mode !== undefined) setMode(next.mode);
    if (next.letter !== undefined) setLetter(next.letter);
    if (next.length !== undefined) setLength(next.length);
    writeUrlState(state);
  }

  if (dictionary.error && !entries) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <PageIntro title={t("pages.dictionary")} />
        <div className={surfaceCard}>
          <StateMessage kind="error" title={t("dictionary.loadFailed")} action={<button type="button" className={secondaryButton} onClick={() => void dictionary.refetch()}>{t("courses.retry")}</button>} />
        </div>
      </div>
    );
  }
  if (!dictionary.data || !entries) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <PageIntro title={t("pages.dictionary")} />
        <StateMessage kind="loading" title={t("common.loading")} />
      </div>
    );
  }

  const chip = (selected: boolean) =>
    `inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm font-bold transition vs-motion ${focusRing} ${selected ? "bg-vs-accent text-vs-on-accent" : "bg-vs-subtle text-vs-fg-2 hover:bg-vs-accent-soft hover:text-vs-accent"}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageIntro title={t("pages.dictionary")} text={t("dictionary.intro", { n: entries.length.toLocaleString(intlLocale), source: dictionary.data.collectionName || t("dictionary.theText") })} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Enter opent het eerste resultaat: zoeken en direct lezen zonder omweg.
          if (searching && filtered[0]) router.push(dictionaryWordHref(filtered[0].word));
        }}
      >
        <SearchField value={query} onChange={(value) => update({ query: value })} placeholder={t("dictionary.search")} label={t("dictionary.searchLabel")} clearLabel={t("dictionary.clear")} />
      </form>

      {!searching && recent.length > 0 && (
        <section aria-labelledby="dictionary-recent" className="flex flex-col gap-2">
          <h2 id="dictionary-recent" className="text-xs font-extrabold uppercase tracking-wider text-vs-fg-3">{t("dictionary.recent")}</h2>
          <ul className="flex flex-wrap gap-2">
            {recent.map((word) => (
              <li key={word}>
                <Link href={dictionaryWordHref(word)} className={`inline-flex h-9 items-center rounded-full border border-vs-line-strong bg-vs-surface px-3 font-serif text-base text-vs-fg hover:bg-vs-subtle ${focusRing}`}>
                  {word}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!searching && (
        <section aria-labelledby="dictionary-browse" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="dictionary-browse" className="text-xs font-extrabold uppercase tracking-wider text-vs-fg-3">{t("dictionary.browse")}</h2>
            <div className="flex rounded-full bg-vs-subtle p-0.5" role="group" aria-label={t("dictionary.browse")}>
              {(["letter", "length"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={mode === value} onClick={() => update({ mode: value })} className={`rounded-full px-3 py-1 text-xs font-bold ${focusRing} ${mode === value ? "bg-vs-surface text-vs-accent shadow-sm" : "text-vs-fg-3"}`}>
                  {t(value === "letter" ? "dictionary.byLetter" : "dictionary.byLength")}
                </button>
              ))}
            </div>
          </div>
          {mode === "letter" ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("dictionary.letterNav")}>
              {letters.map((value) => (
                <button key={value} type="button" aria-pressed={activeLetter === value} onClick={() => update({ letter: value })} className={`${chip(activeLetter === value)} uppercase`}>
                  {value}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("dictionary.byLength")}>
              <button type="button" aria-pressed={length === null} onClick={() => update({ length: null })} className={chip(length === null)}>{t("dictionary.all")}</button>
              {lengths.map((value) => (
                <button key={value} type="button" aria-pressed={length === value} onClick={() => update({ length: value })} className={chip(length === value)}>{value}</button>
              ))}
            </div>
          )}
        </section>
      )}

      <section aria-label={t("pages.dictionary")} className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 className="font-serif text-2xl font-bold uppercase text-vs-accent" aria-hidden={searching}>{!searching && mode === "letter" ? activeLetter : ""}</h2>
          <p className="text-xs text-vs-fg-3" aria-live="polite">
            {t(filtered.length === 1 ? "dictionary.wordsOne" : "dictionary.wordsMany", { n: filtered.length.toLocaleString(intlLocale) })}
          </p>
        </div>
        <div className={`${surfaceCard} overflow-hidden`}>
          {filtered.length === 0 ? (
            <StateMessage kind="empty" icon={SearchX} title={t("dictionary.noWordsFor", { q: query.trim() })} text={t("dictionary.noWordsHint")} />
          ) : (
            <ul className="divide-y divide-vs-line">
              {visible.map((entry) => (
                <li key={entry.word}>
                  <Link href={dictionaryWordHref(entry.word)} className={`flex min-h-12 items-center justify-between gap-4 px-4 py-2.5 hover:bg-vs-subtle active:bg-vs-accent-soft ${focusRing} focus-visible:ring-inset`}>
                    <span className="font-serif text-lg text-vs-fg [overflow-wrap:anywhere]">
                      <MatchedWord word={entry.word} query={searching ? query : ""} />
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-vs-fg-3">{entry.count.toLocaleString(intlLocale)}×</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {filtered.length > visible.length && (
          <button type="button" className={`${secondaryButton} self-center`} onClick={() => setShown({ signature, count: visibleCount + PAGE_SIZE })}>
            {t("dictionary.showMore", { n: Math.min(PAGE_SIZE, filtered.length - visible.length).toLocaleString(intlLocale) })}
          </button>
        )}
      </section>
    </div>
  );
}
