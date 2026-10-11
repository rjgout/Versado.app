import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

const schema = z.object({ text: z.string().max(2000) });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ verseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { verseId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const verse = await prisma.verse.findFirst({
    where: { id: verseId, chapter: { book: { contentCollection: readingAccessWhere(user) } } },
    select: { id: true },
  });
  if (!verse) return await apiError("apiErrors.verseNotFound", 404);

  const text = parsed.data.text.trim();

  if (text.length === 0) {
    await prisma.note.deleteMany({ where: { userId: user.id, verseId } });
    return NextResponse.json({ note: null });
  }

  const note = await prisma.note.upsert({
    where: { userId_verseId: { userId: user.id, verseId } },
    create: { userId: user.id, verseId, text },
    update: { text },
  });
  return NextResponse.json({ note: note.text });
}
