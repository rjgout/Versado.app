"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { useContentScope, useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { getLanguage } from "@/lib/languages";
import { chapterReadHref } from "@/lib/navigation";
import { groupByBook, highlightWord, normalizeWord, similarWords, type WordEntry } from "@/lib/dictionaryView";
import { rememberWord } from "@/lib/useRecentWords";
import { dictionaryWordHref } from "@/components/DictionaryClient";
import StateMessage from "@/components/versado/StateMessage";
import { focusRing, primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";

interface VerseMatch {
  chapterId: string;
  bookName: string;
  chapterNumber: number;
  verseNumber: number;
  text: string;
}

const PAGE_SIZE = 20;

/**
 * De pagina van één woord. Alleen wat de woordenlijst en de verzentabel echt
 * weten: hoe vaak het voorkomt, in welke verzen (per boek, met het woord
 * gemarkeerd en een link naar het hoofdstuk) en welke woorden erop lijken. Er
 * zijn geen definities in de data, dus die worden ook niet verzonnen.
 */
export default function WordDetailClient({ word }: { word: string }) {
  const t = useT();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const scope = useContentScope();
  const target = normalizeWord(word);
  const dictionary = useLiveQuery<{ collectionName: string; entries: WordEntry[] }>(["dictionary", "entries"], () => fetchJson("/api/dictionary"), {
    scopes: ["content"],
    contentScoped: true,
    staleTime: 10 * 60_000,
  });
  const versesQuery = useLiveQuery<{ verses: VerseMatch[] }>(["dictionary", "word", target], () => fetchJson(`/api/dictionary/${encodeURIComponent(target)}`), {
    scopes: ["content"],
    contentScoped: true,
    staleTime: 10 * 60_000,
  });
  const [shownFor, setShownFor] = useState({ word: target, count: PAGE_SIZE });

  const entries = dictionary.data?.entries;
  const entry = entries?.find((candidate) => candidate.word === target);
  const similar = useMemo(() => (entries ? similarWords(entries, target) : []), [entries, target]);
  const collectionId = scope?.collectionId ?? "";

  useEffect(() => {
    if (entry && collectionId) rememberWord(collectionId, entry.word);
  }, [entry, collectionId]);

  const verses = versesQuery.data?.verses;
  const count = shownFor.word === target ? shownFor.count : PAGE_SIZE;
  const groups = useMemo(() => (verses ? groupByBook(verses.slice(0, count)) : []), [verses, count]);

  const back = (
    <Link href="/tools/dictionary" className={secondaryButton}>
      {t("dictionary.backToDictionary")}
    </Link>
  );

  if (dictionary.error && !entries) {
    return (
      <div className={`mx-auto max-w-2xl ${surfaceCard}`}>
        <StateMessage kind="error" title={t("dictionary.loadFailed")} action={<button type="button" className={secondaryButton} onClick={() => void dictionary.refetch()}>{t("courses.retry")}</button>} />
      </div>
    );
  }
  if (!entries) return <div className="mx-auto max-w-2xl"><StateMessage kind="loading" title={t("common.loading")} /></div>;
  if (!entry) {
    return (
      <div className={`mx-auto max-w-2xl ${surfaceCard}`}>
        <StateMessage kind="empty" icon={SearchX} title={t("dictionary.notFoundTitle")} text={target} action={back} />
      </div>
    );
  }

  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-5xl font-bold leading-[1.05] tracking-tight text-vs-fg [overflow-wrap:anywhere] sm:text-6xl" lang={getLanguage(scope?.language ?? "nl").code}>
          {entry.word}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-vs-fg-2">
          <span className="rounded-full bg-vs-accent-soft px-3 py-1 font-bold text-vs-accent">
            {t(entry.count === 1 ? "dictionary.timesOne" : "dictionary.timesMany", { n: entry.count.toLocaleString(intlLocale) })}
          </span>
          {verses && (
            <span className="text-vs-fg-3">{t(verses.length === 1 ? "dictionary.versesOne" : "dictionary.versesMany", { n: verses.length.toLocaleString(intlLocale) })}</span>
          )}
        </p>
      </header>

      <section aria-labelledby="word-verses" className="flex flex-col gap-4">
        <h2 id="word-verses" className="text-xs font-extrabold uppercase tracking-wider text-vs-fg-3">{t("dictionary.versesHeading")}</h2>
        {Boolean(versesQuery.error) && !verses && (
          <StateMessage kind="error" title={t("courses.error")} action={<button type="button" className={secondaryButton} onClick={() => void versesQuery.refetch()}>{t("courses.retry")}</button>} />
        )}
        {!verses && !versesQuery.error && <StateMessage kind="loading" title={t("common.loading")} />}
        {verses && verses.length === 0 && <p className="text-sm text-vs-fg-3">{t("dictionary.noVerses")}</p>}
        {groups.map((group) => (
          <div key={group.bookName} className="flex flex-col gap-1">
            <h3 className="px-1 text-sm font-extrabold text-vs-fg-2">{group.bookName}</h3>
            <ul className={`${surfaceCard} divide-y divide-vs-line overflow-hidden`}>
              {group.items.map((verse) => (
                <li key={`${verse.chapterId}:${verse.verseNumber}`} className="flex flex-col gap-1.5 px-4 py-3.5">
                  <Link href={chapterReadHref(verse.chapterId)} className={`w-fit text-sm font-bold text-vs-accent hover:underline ${focusRing}`} aria-label={`${t("dictionary.openChapter")}: ${verse.bookName} ${verse.chapterNumber}:${verse.verseNumber}`}>
                    {verse.bookName} {verse.chapterNumber}:{verse.verseNumber}
                  </Link>
                  <p className="font-serif text-lg leading-relaxed text-vs-fg">
                    {highlightWord(verse.text, target).map((part, index) =>
                      part.match ? <mark key={index} className="rounded bg-vs-xp-soft px-0.5 font-semibold text-vs-fg">{part.text}</mark> : <span key={index}>{part.text}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {verses && verses.length > count && (
          <button type="button" className={`${primaryButton} self-center`} onClick={() => setShownFor({ word: target, count: count + PAGE_SIZE })}>
            {t("dictionary.showMore", { n: Math.min(PAGE_SIZE, verses.length - count).toLocaleString(intlLocale) })}
          </button>
        )}
      </section>

      {similar.length > 0 && (
        <section aria-labelledby="word-similar" className="flex flex-col gap-3">
          <h2 id="word-similar" className="text-xs font-extrabold uppercase tracking-wider text-vs-fg-3">{t("dictionary.similar")}</h2>
          <ul className="flex flex-wrap gap-2">
            {similar.map((item) => (
              <li key={item.word}>
                <Link href={dictionaryWordHref(item.word)} className={`inline-flex min-h-10 items-center rounded-full border border-vs-line-strong bg-vs-surface px-4 font-serif text-base text-vs-fg hover:bg-vs-subtle ${focusRing}`}>
                  {item.word}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
