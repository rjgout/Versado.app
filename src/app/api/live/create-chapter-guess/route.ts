import { canStartGame } from "@/lib/gameAvailability";
import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextRequest, NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { QUESTION_COUNT_OPTIONS } from "@/lib/chapterGuess";
import { apiError } from "@/lib/apiError";

const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const schema = z.object({
  level: z.enum(["BEGINNER", "ADVANCED", "EXPERT"]),
  questionCount: z.number().refine((n) => (QUESTION_COUNT_OPTIONS as readonly number[]).includes(n)),
}).strict();

// Losse route i.p.v. /api/live/create uit te breiden: dat endpoint is
// chapterId-specifiek voor de bestaande oefeningen-race, dit spel ("Raad het
// hoofdstuk") hangt juist aan geen enkel vast hoofdstuk maar aan
// niveau+aantal vragen (zie LiveGame.mode CHAPTER_GUESS).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "chapter-guess");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.chooseLevelAndCount", 400);
  if (!(await canStartGame(user.id, "chapter-guess", parsed.data.questionCount))) return apiError("gameAvailability.unavailable", 403);

  let code = generateCode();
  for (let attempts = 0; attempts < 5; attempts++) {
    const clash = await prisma.liveGame.findUnique({ where: { code } });
    if (!clash) break;
    code = generateCode();
  }

  const game = await prisma.liveGame.create({
    data: {
      code,
      hostId: user.id,
      mode: "CHAPTER_GUESS",
      level: parsed.data.level,
      questionCount: parsed.data.questionCount,
      status: "LOBBY",
    },
  });
  await prisma.liveGamePlayer.create({ data: { gameId: game.id, userId: user.id } });

  return NextResponse.json({ code: game.code });
}
