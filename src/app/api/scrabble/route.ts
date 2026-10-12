import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { createInvite } from "@/lib/scrabbleGame";
import { apiError, apiErrorText } from "@/lib/apiError";

const createSchema = z.object({ friendUserId: z.string().trim().min(1) }).strict();

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const games = await prisma.scrabbleGame.findMany({
    where: { OR: [{ player1Id: user.id }, { player2Id: user.id }], status: { not: "CANCELLED" } },
    orderBy: { updatedAt: "desc" },
    include: {
      player1: { select: { id: true, handle: true } },
      player2: { select: { id: true, handle: true } },
    },
  });

  return NextResponse.json({
    games: games.map((g) => {
      const isPlayer1 = g.player1Id === user.id;
      const opponent = isPlayer1 ? g.player2 : g.player1;
      return {
        id: g.id,
        status: g.status,
        isSender: isPlayer1,
        opponent: { id: opponent.id, displayName: opponent.handle },
        myScore: isPlayer1 ? g.player1Score : g.player2Score,
        opponentScore: isPlayer1 ? g.player2Score : g.player1Score,
        isMyTurn: g.status === "ACTIVE" && g.turnUserId === user.id,
        won: g.status === "FINISHED" ? g.winnerUserId === user.id : null,
        tied: g.status === "FINISHED" ? g.winnerUserId === null : null,
        updatedAt: g.updatedAt,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "scrabble");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const result = await createInvite(user.id, parsed.data.friendUserId);
  if ("error" in result) return await apiErrorText(result.error, 400);
  return NextResponse.json(result);
}
