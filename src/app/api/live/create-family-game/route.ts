import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextRequest, NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { DURATION_OPTIONS } from "@/lib/familyGame";
import { apiError } from "@/lib/apiError";

const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const schema = z.object({
  minutes: z.number().refine((n) => (DURATION_OPTIONS as readonly number[]).includes(n)),
  diceMode: z.enum(["DIGITAL", "PHYSICAL"]),
}).strict();

// Losse route i.p.v. /api/live/create uit te breiden: dat endpoint is
// chapterId-specifiek, het Gezinsavondspel hangt juist aan geen enkel vast
// hoofdstuk maar aan speelduur+dobbelsteenkeuze (zie LiveGame.mode
// FAMILY_GAME). Hergebruikt verder hetzelfde lobby-/uitnodig-/annuleer-
// mechanisme als elk ander live spel (zie src/server/gameServer.ts).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "gezinsavond");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.chooseDurationAndDice", 400);

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
      mode: "FAMILY_GAME",
      familyGameMinutes: parsed.data.minutes,
      familyGameDiceMode: parsed.data.diceMode,
      status: "LOBBY",
    },
  });
  await prisma.liveGamePlayer.create({ data: { gameId: game.id, userId: user.id } });

  return NextResponse.json({ code: game.code });
}
