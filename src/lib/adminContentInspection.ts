import { prisma } from "@/lib/db";

/** Expliciete beheercontext: uitsluitend technische contentmetadata, geen gebruikersgegevens. */
export async function getAdminContentInspection() {
  const [works, collections] = await Promise.all([
    prisma.contentWork.findMany({ orderBy: { key: "asc" }, select: { key: true, kind: true } }),
    prisma.contentCollection.findMany({ orderBy: [{ order: "asc" }, { id: "asc" }], select: {
      id: true, name: true, work: true, editionKey: true, language: true,
      enabled: true, visibleToUsers: true, publicationState: true,
      books: { take: 1, where: { chapters: { some: { verses: { some: {} } } } }, select: { id: true } },
    } }),
  ]);
  const scriptureWorks = new Set(works.filter(work => work.kind === "SCRIPTURE").map(work => work.key));
  return { works, collections: collections.map(({ books, ...collection }) => ({ ...collection,
    previewHref: scriptureWorks.has(collection.work ?? "") && books.length > 0
      ? `/adminbackend/content-preview?collectionId=${encodeURIComponent(collection.id)}` : null,
    managementHref: collection.work === "fsy" ? "/adminbackend/content#fsy-management" : null,
  })) };
}
export type AdminContentInspection = Awaited<ReturnType<typeof getAdminContentInspection>>;
