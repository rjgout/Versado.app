import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { markReadingStarted } from "@/lib/learning/contentProgress";

const schema = z.object({ chapterId: z.string().min(1) });

// Registreert dat een gebruiker een hoofdstuk is gaan lezen — los van de
// oefeningen erna. Het hoofdstuk staat daarmee als "bezig" in elke
// leesroute (zie src/lib/learning/contentProgress.ts). Geen XP, geen reeks.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const chapter = await prisma.chapter.findFirst({ where: { id: parsed.data.chapterId, book: { contentCollection: readingAccessWhere(user) } }, select: { id: true } });
  if (!chapter) return await apiError("apiErrors.chapterNotFound", 404);
  const session = await prisma.readingSession.create({
    data: { userId: user.id, chapterId: chapter.id },
  });
  await markReadingStarted(user.id, chapter.id);
  return NextResponse.json({ id: session.id });
}
