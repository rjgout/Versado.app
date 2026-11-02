import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { chapterLocks } from "@/lib/readingCourses";
import { contentKeyOf } from "@/lib/learning/contentProgress";
import { context, envelope, nativeCoursePath, recheck } from "./courses.server";
import { NativeAuthError, type NativeSessionBinding } from "./sessions";
import { nativeReaderSchema, type NativeReaderKind } from "./readerContract";
import type { NativeCoursePath } from "./coursesContract";

/** Dezelfde volgorde/slots als het leerpad; geen tweede cursor- of voortgangsberekening. */
function selection(
  path: NativeCoursePath,
  kind: NativeReaderKind,
  targetId: string,
) {
  if (kind === "steps" && path.kind === "steps") {
    for (const chapter of path.chapters) {
      const step = chapter.steps.find((s) => s.id === targetId);
      if (step) {
        if (!step.available) break;
        return {
          chapterId: chapter.id,
          start: step.startVerse,
          end: step.endVerse,
        };
      }
    }
  }
  if (kind === "chapters" && path.kind === "chapters") {
    const chapter = path.chapters.find((c) => c.id === targetId);
    if (
      chapter &&
      !chapterLocks(path.chapters, path.sequential).get(chapter.id)
    )
      return { chapterId: chapter.id, start: 1, end: chapter.verseCount };
  }
  throw new NativeAuthError("content_unavailable", 404);
}
/** Uitsluitend lezen: geen web-SSR-loader, cursorsync, oefensessie of afronding. */
export async function nativeScriptureReader(
  binding: NativeSessionBinding,
  courseId: string,
  kind: NativeReaderKind,
  targetId: string,
  db: Prisma.TransactionClient = prisma,
) {
  const value = await context(binding, db);
  const path = await nativeCoursePath(binding, courseId, db);
  if (
    path.activeCollectionId !== value.picker.activeCollectionId ||
    path.selectionVersion !== value.picker.selectionVersion
  )
    throw new NativeAuthError("content_context_changed", 409);
  const chosen = selection(path, kind, targetId);
  if (chosen.start < 1 || chosen.end > 500 || chosen.end < chosen.start)
    throw new NativeAuthError("content_unavailable", 404);
  const where = {
    id: chosen.chapterId,
    book: {
      contentCollectionId: value.picker.activeCollectionId ?? "",
      contentCollection: { ...readingAccessWhere(value.user), work: "bofm" },
    },
  };
  const chapter = await db.chapter.findFirst({
    where,
    select: {
      id: true,
      number: true,
      book: {
        select: {
          key: true,
          name: true,
          contentCollection: { select: { language: true, name: true } },
        },
      },
    },
  });
  if (!chapter) throw new NativeAuthError("content_unavailable", 404);
  const [verses, position] = await Promise.all([
    db.verse.findMany({
      where: {
        chapterId: chapter.id,
        number: { gte: chosen.start, lte: chosen.end },
      },
      orderBy: { number: "asc" },
      take: 501,
      select: { id: true, number: true, text: true },
    }),
    db.contentProgress.findUnique({
      where: {
        userId_contentKey: {
          userId: value.user.id,
          contentKey: contentKeyOf(chapter),
        },
      },
      select: { readStatus: true, readVerse: true, lastChapterId: true },
    }),
  ]);
  // Ook na de tekstquery: sessie/ABA/bron en bestaande cursus-/staprechten opnieuw bepalen.
  const latest = await nativeCoursePath(binding, courseId, db),
    again = selection(latest, kind, targetId);
  await recheck(binding, value, db);
  if (
    latest.selectionVersion !== value.picker.selectionVersion ||
    latest.activeCollectionId !== value.picker.activeCollectionId ||
    JSON.stringify(again) !== JSON.stringify(chosen) ||
    !(await db.chapter.findFirst({ where, select: { id: true } }))
  )
    throw new NativeAuthError("content_context_changed", 409);
  const focusVerse =
    position?.lastChapterId === chapter.id && position.readStatus === "READING"
      ? Math.min(chosen.end, Math.max(chosen.start, position.readVerse + 1))
      : chosen.start;
  const result = nativeReaderSchema.safeParse({
    ...envelope(value),
    activeCollectionId: value.picker.activeCollectionId,
    courseId,
    kind,
    targetId,
    chapterId: chapter.id,
    bookName: chapter.book.name,
    chapterNumber: chapter.number,
    collectionName: chapter.book.contentCollection.name,
    sourceLanguage: chapter.book.contentCollection.language,
    startVerse: chosen.start,
    endVerse: chosen.end,
    focusVerse,
    verses,
  });
  if (!result.success) throw new NativeAuthError("content_unavailable", 404);
  return result.data;
}
