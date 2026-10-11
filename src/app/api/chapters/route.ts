import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { getContentContext } from "@/lib/contentCollections";
import { apiError } from "@/lib/apiError";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const contentContext = await getContentContext(user.id);

  const chapters = await prisma.chapter.findMany({
    where: { book: { contentCollectionId: contentContext.active.id, contentCollection: readingAccessWhere(user) } },
    orderBy: [{ book: { order: "asc" } }, { order: "asc" }],
    include: { book: true, _count: { select: { exercises: { where: { status: "APPROVED" } } } } },
  });

  return NextResponse.json(
    chapters.map((c) => ({
      id: c.id,
      label: `${c.book.name} ${c.number}`,
      exerciseCount: c._count.exercises,
      bookId: c.bookId,
      bookName: c.book.name,
      number: c.number,
    }))
  );
}
