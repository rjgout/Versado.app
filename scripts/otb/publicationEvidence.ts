import { createHash } from "node:crypto";

/** Exact de tekstvelden die de bestaande OTB-importer schrijft. Geen audio of gebruiksdata. */
export interface PublicationBook {
  key: string | null;
  slug: string;
  name: string;
  order: number;
  chapters: { number: number; order: number; verses: { number: number; text: string }[] }[];
}
export function publicationTextEvidence(books: PublicationBook[]) {
  const ordered = [...books].sort((a, b) => a.order - b.order || (a.key ?? "").localeCompare(b.key ?? ""));
  const canonical = ordered.map(book => [book.key, book.slug, book.name, book.order,
    [...book.chapters].sort((a,b) => a.number-b.number).map(chapter => [chapter.number, chapter.order,
      [...chapter.verses].sort((a,b) => a.number-b.number).map(verse => [verse.number, verse.text])])]);
  return {
    books: books.length,
    chapters: books.reduce((n, book) => n + book.chapters.length, 0),
    verses: books.reduce((n, book) => n + book.chapters.reduce((m, chapter) => m + chapter.verses.length, 0), 0),
    sha256: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
export function publicationObjectHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
