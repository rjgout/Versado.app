import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

export async function GET(_req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { gameId } = await params;
  const game = await prisma.scrabbleGame.findUnique({
    where: { id: gameId },
    include: {
      player1: { select: { id: true, handle: true } },
      player2: { select: { id: true, handle: true } },
      moves: { orderBy: { createdAt: "asc" }, include: { user: { select: { handle: true } } } },
    },
  });
  if (!game || game.status === "CANCELLED" || (game.player1Id !== user.id && game.player2Id !== user.id)) {
    return await apiError("apiErrors.gameNotFound", 404);
  }

  const isPlayer1 = game.player1Id === user.id;
  const opponent = isPlayer1 ? game.player2 : game.player1;
  const myRack: string[] = JSON.parse(isPlayer1 ? game.player1Rack : game.player2Rack);
  const opponentRack: string[] = JSON.parse(isPlayer1 ? game.player2Rack : game.player1Rack);
  const bag: string[] = JSON.parse(game.bag);

  // Wie welke tegel legde en welke het laatst zijn gelegd, afgeleid uit de
  // zetgeschiedenis (het bord zelf bewaart alleen letters). "Laatst gelegd" =
  // alles wat de tegenstander legde sinds jouw laatste zet; heb jij als
  // laatste gelegd, dan jouw laatste woord. Het bord laat die tegels bij
  // binnenkomst even oplichten.
  const tilesOf = (tilesPlaced: string | null) =>
    tilesPlaced ? (JSON.parse(tilesPlaced) as { row: number; col: number }[]).map((t) => `${t.row},${t.col}`) : [];
  const myTileKeys = game.moves.filter((m) => m.userId === user.id).flatMap((m) => tilesOf(m.tilesPlaced));
  let lastOwnMoveIndex = -1;
  game.moves.forEach((m, index) => {
    if (m.userId === user.id) lastOwnMoveIndex = index;
  });
  let recentTileKeys = game.moves.slice(lastOwnMoveIndex + 1).flatMap((m) => tilesOf(m.tilesPlaced));
  if (recentTileKeys.length === 0) {
    const lastPlace = [...game.moves].reverse().find((m) => m.type === "PLACE");
    recentTileKeys = lastPlace ? tilesOf(lastPlace.tilesPlaced) : [];
  }

  return NextResponse.json({
    id: game.id,
    status: game.status,
    board: JSON.parse(game.board),
    myTileKeys,
    recentTileKeys,
    myRack,
    // De letters van de tegenstander blijven bewust geheim — alleen het
    // aantal, zodat je wél kunt zien hoeveel die nog moet spelen.
    opponentRackCount: opponentRack.length,
    bagCount: bag.length,
    myScore: isPlayer1 ? game.player1Score : game.player2Score,
    opponentScore: isPlayer1 ? game.player2Score : game.player1Score,
    // Eén gedeeld tegoed (verdiend of gekocht, overal inzetbaar) — zie
    // scrabbleHint in src/lib/scrabbleGame.ts.
    myHintCredits: user.hintBalance,
    isMyTurn: game.status === "ACTIVE" && game.turnUserId === user.id,
    opponent: { id: opponent.id, displayName: opponent.handle },
    won: game.status === "FINISHED" ? game.winnerUserId === user.id : null,
    tied: game.status === "FINISHED" ? game.winnerUserId === null : null,
    moves: game.moves.map((m) => ({
      id: m.id,
      playerName: m.user.handle,
      isMine: m.userId === user.id,
      type: m.type,
      wordsFormed: m.wordsFormed ? (JSON.parse(m.wordsFormed) as string[]) : [],
      score: m.score,
      createdAt: m.createdAt,
    })),
  });
}
