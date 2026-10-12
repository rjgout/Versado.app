import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { ReaderView, type ReaderVerseView } from "@/components/LessonFlow";
import PageIntro from "@/components/versado/PageIntro";
import type { OtbWork } from "../../../../scripts/otb/trialConfig";

const LANGUAGES = [
  { code: "nl", label: "Nederlands" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
] as const;


function isWork(value: string | undefined): value is OtbWork {
  return value === "old-testament" || value === "new-testament";
}

function numberParam(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

export default async function ContentPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ work?: string; language?: string; book?: string; chapter?: string; collectionId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const t = getT(user.uiLanguage);
  const query = await searchParams;
  const work = isWork(query.work) ? query.work : "old-testament";
  const language = LANGUAGES.some((item) => item.code === query.language) ? query.language! : "nl";
  const collection = await prisma.contentCollection.findFirst({
    where: { ...readingAccessWhere(user, "admin-preview"), contentWork: { kind: "SCRIPTURE" }, ...(query.collectionId ? { id: query.collectionId } : { work, language, editionKey: "otb" }) },
    select: { id: true, name: true, work: true, language: true, editionKey: true },
  });

  if (!collection) {
    return <PreviewShell><p className="card text-sm text-vs-fg-3">{t("adminContentInspect.noText")}</p></PreviewShell>;
  }

  const term = chapterTerm(null, collection.id);
  const displayTerm = localizeTerm(term, t);
  const exactQuery = query.collectionId ? `collectionId=${encodeURIComponent(collection.id)}&` : "";
  const books = await prisma.book.findMany({
    where: { contentCollectionId: collection.id },
    orderBy: { order: "asc" },
    select: { id: true, key: true, name: true, order: true },
  });
  const selectedBook = books.find((book) => book.key === query.book) ?? books[0];
  const chapters = selectedBook
    ? await prisma.chapter.findMany({ where: { book: { contentCollectionId: collection.id, key: selectedBook.key } }, orderBy: { number: "asc" }, select: { number: true } })
    : [];
  const selectedChapterNumber = numberParam(query.chapter);
  const chapterNumber = chapters.some((chapter) => chapter.number === selectedChapterNumber) ? selectedChapterNumber! : chapters[0]?.number;
  const chapter = selectedBook && chapterNumber
    ? await prisma.chapter.findUnique({
        where: { bookId_number: { bookId: selectedBook.id, number: chapterNumber } },
        select: { id: true, number: true, verses: { orderBy: { number: "asc" }, select: { id: true, number: true, text: true } } },
      })
    : null;
  const navigationChapters = await prisma.chapter.findMany({
    where: { book: { contentCollectionId: collection.id } },
    orderBy: [{ book: { order: "asc" } }, { number: "asc" }],
    select: { number: true, book: { select: { key: true } } },
  });
  const navigationIndex = selectedBook && chapterNumber !== undefined
    ? navigationChapters.findIndex((item) => item.book.key === selectedBook.key && item.number === chapterNumber)
    : -1;
  const previous = navigationIndex > 0 ? navigationChapters[navigationIndex - 1] : null;
  const next = navigationIndex >= 0 ? navigationChapters[navigationIndex + 1] ?? null : null;
  const verses: ReaderVerseView[] = chapter?.verses.map((verse) => ({
    ...verse,
    bookmarked: false,
    highlighted: false,
    note: "",
  })) ?? [];

  return (
    <PreviewShell>
      <div className="flex flex-col gap-6">
        {/* De terugknop komt uit SubpageBackBar (terug naar Content en cursussen). */}
        <PageIntro title={t("adminContentInspect.previewTitle")} text={t("adminContentInspect.previewIntro")} />
        <p className="text-sm font-bold text-vs-fg-2">{collection.name} · {collection.editionKey} · {collection.language}</p>

        <form method="get" className="card grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {query.collectionId && <input type="hidden" name="collectionId" value={collection.id} />}
          <label className="flex flex-col gap-1 text-sm font-bold">{t("adminContentInspect.work")}
            <select className="input" name="work" disabled={Boolean(query.collectionId)} defaultValue={collection.work ?? work}>{query.collectionId ? <option value={collection.work ?? ""}>{collection.name}</option> : <><option value="old-testament">Oude Testament</option><option value="new-testament">Nieuwe Testament</option></>}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">{t("adminContentInspect.language")}
            <select className="input" name="language" disabled={Boolean(query.collectionId)} defaultValue={collection.language}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">{t("adminContentInspect.book")}
            <select className="input" name="book" defaultValue={selectedBook?.key ?? ""}>{books.map((book) => <option key={book.key ?? book.name} value={book.key ?? ""}>{book.name}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">{displayTerm.singular}
            <select className="input" name="chapter" defaultValue={chapterNumber ?? ""}>{chapters.map((item) => <option key={item.number} value={item.number}>{item.number}</option>)}</select>
          </label>
          <button className="btn-primary sm:col-span-2 lg:col-span-4 justify-self-start" type="submit">{t("adminContentInspect.showChapter")}</button>
        </form>

        {chapter && selectedBook ? (
          <section className="flex flex-col gap-3">
            <ReaderView
              chapterId={chapter.id}
              bookName={selectedBook.name}
              chapterNumber={chapter.number}
              verses={verses}
              term={term}
              language={collection.language}
              preview
            />
            <div className="flex items-center justify-between gap-3">
              {previous ? <Link className="btn-secondary" href={`/adminbackend/content-preview?${exactQuery}work=${work}&language=${language}&book=${previous.book.key}&chapter=${previous.number}`}>← {t(`terms.${term.kind}.previous`)}</Link> : <span />}
              {next ? <Link className="btn-primary" href={`/adminbackend/content-preview?${exactQuery}work=${work}&language=${language}&book=${next.book.key}&chapter=${next.number}`}>{t(`terms.${term.kind}.next`)}</Link> : <span />}
            </div>
          </section>
        ) : <p className="card text-sm text-vs-fg-3">{t("adminContentInspect.noText")}</p>}
      </div>
    </PreviewShell>
  );
}

function PreviewShell({ children }: { children: ReactNode }) {
  return <div className="max-w-4xl mx-auto flex flex-col gap-8">{children}</div>;
}
