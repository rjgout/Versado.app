import { gameStartGuard } from "@/lib/gameStartGuard";
import { getContentContext } from "@/lib/contentCollections";
import { NextRequest, NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const schema = z.object({ chapterId: z.string().min(1) }).strict();

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "live-exercises");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.chooseChapter", 400);

  const context = await getContentContext(user.id);
  const chapter = await prisma.chapter.findFirst({ where: { id: parsed.data.chapterId, book: { contentCollectionId: context.active.id, contentCollection: readingAccessWhere(user) }, exercises: { some: { status: "APPROVED" } } } });
  if (!chapter) return await apiError("apiErrors.chapterNotFoundDot", 404);

  let code = generateCode();
  for (let attempts = 0; attempts < 5; attempts++) {
    const clash = await prisma.liveGame.findUnique({ where: { code } });
    if (!clash) break;
    code = generateCode();
  }

  const game = await prisma.liveGame.create({
    data: { code, hostId: user.id, chapterId: chapter.id, status: "LOBBY" },
  });
  await prisma.liveGamePlayer.create({ data: { gameId: game.id, userId: user.id } });

  return NextResponse.json({ code: game.code });
}
