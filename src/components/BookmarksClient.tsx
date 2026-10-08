"use client";

import Link from "next/link";
import { Bookmark } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { chapterReadHref } from "@/lib/navigation";
import PageIntro from "@/components/versado/PageIntro";
import StateMessage from "@/components/versado/StateMessage";
import { focusRing, secondaryButton, surfaceCard } from "@/components/versado/styles";

interface BookmarkItem {
  verseId: string;
  bookName: string;
  chapterNumber: number;
  chapterId: string;
  verseNumber: number;
  text: string;
}

export default function BookmarksClient() {
  const t = useT();
  // Bladwijzers worden tijdens het lezen toegevoegd of verwijderd; bij terugkomen altijd actueel.
  const bookmarks = useLiveQuery<BookmarkItem[]>(["bookmarks"], () => fetchJson<BookmarkItem[]>("/api/bookmarks"), { scopes: ["content"], staleTime: 1_000 });
  const items = bookmarks.data;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageIntro title={t("pages.bookmarks")} text={t("bookmarks.subtitle")} />

      {!items && !bookmarks.error && <StateMessage kind="loading" title={t("common.loading")} />}
      {!items && Boolean(bookmarks.error) && (
        <div className={surfaceCard}>
          <StateMessage kind="error" title={t("bookmarks.loadFailed")} action={<button type="button" className={secondaryButton} onClick={() => void bookmarks.refetch()}>{t("courses.retry")}</button>} />
        </div>
      )}
      {items && items.length === 0 && (
        <div className={surfaceCard}>
          <StateMessage kind="empty" icon={Bookmark} title={t("bookmarks.empty")} />
        </div>
      )}

      {items && items.length > 0 && (
        <ul className={`${surfaceCard} divide-y divide-vs-line overflow-hidden`}>
          {items.map((b) => (
            <li key={b.verseId}>
              <Link href={chapterReadHref(b.chapterId)} className={`flex flex-col gap-1.5 px-4 py-4 hover:bg-vs-subtle active:bg-vs-accent-soft sm:px-5 ${focusRing} focus-visible:ring-inset`}>
                <span className="text-sm font-bold text-vs-accent">{b.bookName} {b.chapterNumber}:{b.verseNumber}</span>
                <span className="font-serif text-lg leading-relaxed text-vs-fg">{b.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
