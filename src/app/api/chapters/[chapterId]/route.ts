import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ chapterId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { chapterId } = await params;
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, book: { contentCollection: readingAccessWhere(user) } },
    include: {
      book: true,
      verses: { orderBy: { number: "asc" } },
      exercises: { orderBy: { order: "asc" }, where: { status: "APPROVED" } },
    },
  });
  if (!chapter) return await apiError("apiErrors.chapterNotFound", 404);

  return NextResponse.json({
    id: chapter.id,
    bookName: chapter.book.name,
    number: chapter.number,
    verses: chapter.verses.map((v) => ({ number: v.number, text: v.text })),
    exercises: chapter.exercises.map((e) => ({
      id: e.id,
      type: e.type,
      verseRef: e.verseRef,
      prompt: e.prompt,
      hint: e.hint,
      blanks: (JSON.parse(e.answers) as string[]).length,
      wordBank: e.wordBank ? (JSON.parse(e.wordBank) as string[]) : undefined,
    })),
  });
}
