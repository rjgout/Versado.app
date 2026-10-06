import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ReaderView, type ReaderVerseView } from "@/components/LessonFlow";
import { OTB_TRIAL_BOOK_NUMBERS, otbWorkForBookNumber, type OtbWork } from "../../../../scripts/otb/trialConfig";
import { OTB_BOOK_KEY_BY_NUMBER } from "../../../../scripts/otb/bookMapping";

const LANGUAGES = [
  { code: "nl", label: "Nederlands" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
] as const;

const WORKS = [
  { value: "old-testament" as const, label: "Oude Testament" },
  { value: "new-testament" as const, label: "Nieuwe Testament" },
];

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
  searchParams: Promise<{ work?: string; language?: string; book?: string; chapter?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const query = await searchParams;
  const work = isWork(query.work) ? query.work : "old-testament";
  const language = LANGUAGES.some((item) => item.code === query.language) ? query.language! : "nl";
  const collection = await prisma.contentCollection.findFirst({
    where: { work, editionKey: "otb", language, enabled: true },
    select: { id: true, name: true, sourceName: true, sourceUrl: true, licenseName: true, licenseUrl: true },
  });

  if (!collection) {
    return <PreviewShell><EmptyState work={work} language={language} /></PreviewShell>;
  }

  const books = await prisma.book.findMany({
    where: { contentCollectionId: collection.id },
    orderBy: { order: "asc" },
    select: { id: true, key: true, name: true, order: true },
  });
  const trialBooks = books.filter((book) => OTB_TRIAL_BOOK_NUMBERS.some((number) => OTB_BOOK_KEY_BY_NUMBER.get(number) === book.key && otbWorkForBookNumber(number) === work));
  const selectedBook = trialBooks.find((book) => book.key === query.book) ?? trialBooks[0];
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
  const verses: ReaderVerseView[] = chapter?.verses.map((verse) => ({
    ...verse,
    bookmarked: false,
    highlighted: false,
    note: "",
  })) ?? [];

  return (
    <PreviewShell>
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/adminbackend" className="text-sm font-bold text-vs-accent hover:underline">← Beheer</Link>
          <h1 className="mt-3 text-2xl font-extrabold text-brand-800 dark:text-brand-300">Schriftpreview</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Alleen-lezenweergave van verborgen OTB-proefcontent.</p>
        </div>

        <form method="get" className="card grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm font-bold">Schriftwerk
            <select className="input" name="work" defaultValue={work}><option value="old-testament">Oude Testament</option><option value="new-testament">Nieuwe Testament</option></select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">Taal
            <select className="input" name="language" defaultValue={language}>{LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">Boek
            <select className="input" name="book" defaultValue={selectedBook && selectedBook.key ? selectedBook.key : undefined}>{trialBooks.map((book) => <option key={book.key ?? book.name} value={book.key ?? ""}>{book.name}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">Hoofdstuk
            <select className="input" name="chapter" defaultValue={chapterNumber ?? ""}>{chapters.map((item) => <option key={item.number} value={item.number}>{item.number}</option>)}</select>
          </label>
          <button className="btn-primary sm:col-span-2 lg:col-span-4 justify-self-start" type="submit">Toon hoofdstuk</button>
        </form>

        {chapter && selectedBook ? (
          <section className="flex flex-col gap-3">
            <div className="rounded-xl border border-vs-line bg-vs-subtle px-4 py-3 text-xs text-vs-fg-2">
              <strong>{collection.sourceName}</strong> · {collection.licenseName}
              {collection.sourceUrl && <> · <a className="underline" href={collection.sourceUrl} target="_blank" rel="noreferrer">bron</a></>}
              {collection.licenseUrl && <> · <a className="underline" href={collection.licenseUrl} target="_blank" rel="noreferrer">licentie</a></>}
            </div>
            <ReaderView
              chapterId={chapter.id}
              bookName={selectedBook.name}
              chapterNumber={chapter.number}
              verses={verses}
              language={language}
              preview
            />
          </section>
        ) : <p className="card text-sm text-slate-500 dark:text-slate-400">Deze proefcollectie of dit hoofdstuk is nog niet geïmporteerd.</p>}
      </div>
    </PreviewShell>
  );
}

function PreviewShell({ children }: { children: ReactNode }) {
  return <div className="max-w-4xl mx-auto flex flex-col gap-8">{children}</div>;
}

function EmptyState({ work, language }: { work: OtbWork; language: string }) {
  return <div className="card text-sm text-slate-500 dark:text-slate-400">Geen verborgen OTB-collectie gevonden voor {WORKS.find((item) => item.value === work)?.label} · {language}.</div>;
}
