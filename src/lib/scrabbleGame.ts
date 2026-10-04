import { prisma } from "@/lib/db";
import { emptyBoard, type Board } from "@/lib/scrabble/board";
import { createBag, drawTiles, consumeFromRack, letterValue, shuffle, RACK_SIZE, BLANK } from "@/lib/scrabble/tiles";
import { validateAndScoreMove, type Placement } from "@/lib/scrabble/engine";
import { findHint } from "@/lib/scrabble/hint";
import { notifyScrabbleInvite, notifyScrabbleDeclined, notifyScrabbleYourTurn, notifyScrabbleFinished } from "@/lib/notify";
import { awardCompetitionXp } from "@/lib/competitionXp";
import { SCRABBLE_WIN_XP, SCRABBLE_PARTICIPATION_XP } from "@/lib/xpRules";

// Scrabble geeft (net als Uitdagingen) bewust geen algemene XP — zie
// completeChapterGuess e.a. in streak.ts, die dat wel doen.
// Dit is puur competitie-XP (zie src/lib/competitionXp.ts): een activiteit
// die vroeger nul invloed had op de wekelijkse competitie, telt nu wel mee,
// zonder de algemene XP-economie (winkel, achievements) aan te raken.

/** Wordt aangeroepen op elk van de drie afrondpunten (winst, gelijkspel, opgeven). */
async function awardScrabbleCompetitionXp(winnerUserId: string | null, player1Id: string, player2Id: string): Promise<void> {
  await prisma
    .$transaction(async (tx) => {
      if (winnerUserId) {
        const loserId = winnerUserId === player1Id ? player2Id : player1Id;
        await awardCompetitionXp(tx, winnerUserId, "SCRABBLE_WON", SCRABBLE_WIN_XP);
        await awardCompetitionXp(tx, loserId, "SCRABBLE_PLAYED", SCRABBLE_PARTICIPATION_XP);
      } else {
        await awardCompetitionXp(tx, player1Id, "SCRABBLE_PLAYED", SCRABBLE_PARTICIPATION_XP);
        await awardCompetitionXp(tx, player2Id, "SCRABBLE_PLAYED", SCRABBLE_PARTICIPATION_XP);
      }
    })
    .catch(() => {});
}

// Aantal opeenvolgende beurten zonder plaatsing (pas/wissel) waarna een
// partij ook eindigt zonder dat de zak leeg hoeft te zijn — voorkomt een
// partij die voor altijd vastloopt als geen van beiden nog een woord ziet.
const PASS_LIMIT = 6;

function parseBoard(json: string): Board {
  return JSON.parse(json);
}
function parseRack(json: string): string[] {
  return JSON.parse(json);
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  score?: number;
  wordsFormed?: string[];
}

export async function createInvite(senderId: string, receiverId: string): Promise<{ id: string } | { error: string }> {
  if (senderId === receiverId) return { error: "Je kan jezelf niet uitdagen." };

  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ],
    },
  });
  if (!friendship) return { error: "Je kan alleen vrienden uitdagen." };

  const sender = await prisma.user.findUniqueOrThrow({ where: { id: senderId } });
  const game = await prisma.scrabbleGame.create({
    data: {
      player1Id: senderId,
      player2Id: receiverId,
      status: "PENDING",
      board: JSON.stringify(emptyBoard()),
      bag: "[]",
      player1Rack: "[]",
      player2Rack: "[]",
    },
  });

  notifyScrabbleInvite(receiverId, sender.handle).catch(() => {});
  return { id: game.id };
}

const CANCELLED_ERROR = "Deze uitnodiging is ingetrokken.";

export async function acceptInvite(gameId: string, userId: string): Promise<ActionResult> {
  const game = await prisma.scrabbleGame.findUnique({
    where: { id: gameId },
    include: { player1: true, player2: true },
  });
  if (!game || game.player2Id !== userId) return { ok: false, error: "Spel niet gevonden." };
  if (game.status === "CANCELLED") return { ok: false, error: CANCELLED_ERROR };
  if (game.status !== "PENDING") return { ok: false, error: "Deze uitnodiging is al beantwoord." };

  const bag = createBag();
  const d1 = drawTiles(bag, RACK_SIZE);
  const d2 = drawTiles(d1.remaining, RACK_SIZE);

  // Alleen zolang de uitnodiging nog openstaat: trekt de uitdager 'm net op
  // hetzelfde moment in, dan mag accepteren dat niet ongedaan maken.
  const accepted = await prisma.scrabbleGame.updateMany({
    where: { id: gameId, status: "PENDING" },
    data: {
      status: "ACTIVE",
      bag: JSON.stringify(d2.remaining),
      player1Rack: JSON.stringify(d1.drawn),
      player2Rack: JSON.stringify(d2.drawn),
      turnUserId: game.player1Id,
    },
  });
  if (accepted.count === 0) return { ok: false, error: CANCELLED_ERROR };

  // Uitnodiger speelt als eerste, en krijgt dus nu meteen een "jij bent aan
  // de beurt"-melding — met de naam van de speler die zojuist accepteerde.
  notifyScrabbleYourTurn(game.player1Id, game.player2.handle).catch(() => {});
  return { ok: true };
}

export async function declineInvite(gameId: string, userId: string): Promise<ActionResult> {
  const game = await prisma.scrabbleGame.findUnique({ where: { id: gameId }, include: { player2: true } });
  if (!game || game.player2Id !== userId) return { ok: false, error: "Spel niet gevonden." };
  if (game.status === "CANCELLED") return { ok: false, error: CANCELLED_ERROR };
  if (game.status !== "PENDING") return { ok: false, error: "Deze uitnodiging is al beantwoord." };

  await prisma.scrabbleGame.update({ where: { id: gameId }, data: { status: "DECLINED" } });
  notifyScrabbleDeclined(game.player1Id, game.player2.handle).catch(() => {});
  return { ok: true };
}

export async function cancelInvite(gameId: string, userId: string): Promise<ActionResult> {
  // Voorwaardelijk bijwerken, zodat een uitnodiging die net geaccepteerd is
  // niet alsnog ingetrokken wordt.
  const result = await prisma.scrabbleGame.updateMany({
    where: { id: gameId, player1Id: userId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (result.count === 0) return { ok: false, error: "Deze uitnodiging is al beantwoord." };
  return { ok: true };
}

export async function placeMove(
  gameId: string,
  userId: string,
  rawPlacements: { row: number; col: number; letter: string; isBlank: boolean }[]
): Promise<ActionResult> {
  const game = await prisma.scrabbleGame.findUnique({
    where: { id: gameId },
    include: { player1: true, player2: true },
  });
  if (!game) return { ok: false, error: "Spel niet gevonden." };
  if (game.status !== "ACTIVE") return { ok: false, error: "Dit spel is niet actief." };
  if (game.turnUserId !== userId) return { ok: false, error: "Jij bent niet aan de beurt." };

  const isPlayer1 = userId === game.player1Id;
  if (!isPlayer1 && userId !== game.player2Id) return { ok: false, error: "Je speelt niet mee in dit spel." };

  const board = parseBoard(game.board);
  const rack = parseRack(isPlayer1 ? game.player1Rack : game.player2Rack);
  const opponentRack = parseRack(isPlayer1 ? game.player2Rack : game.player1Rack);

  const placements: Placement[] = rawPlacements.map((p) => ({
    row: p.row,
    col: p.col,
    letter: p.letter.toUpperCase(),
    isBlank: p.isBlank,
  }));

  const rackAfterConsume = consumeFromRack(
    rack,
    placements.map((p) => ({ letter: p.letter, isBlank: p.isBlank }))
  );
  if (!rackAfterConsume) return { ok: false, error: "Je hebt deze letters niet op je rek." };

  const validation = validateAndScoreMove(board, placements);
  if (!validation.ok) return { ok: false, error: validation.error };

  for (const p of placements) board[p.row][p.col] = { letter: p.letter, isBlank: p.isBlank };

  let bag = parseRack(game.bag);
  const drawCount = RACK_SIZE - rackAfterConsume.length;
  const { drawn, remaining } = drawTiles(bag, drawCount);
  bag = remaining;
  const newRack = [...rackAfterConsume, ...drawn];

  const opponentId = isPlayer1 ? game.player2Id : game.player1Id;
  let myScore = (isPlayer1 ? game.player1Score : game.player2Score) + validation.result.score;
  let opponentScore = isPlayer1 ? game.player2Score : game.player1Score;

  let finished = false;
  let winnerUserId: string | null = null;
  if (newRack.length === 0 && bag.length === 0) {
    finished = true;
    const opponentRackValue = opponentRack.reduce((sum, l) => sum + letterValue(l), 0);
    myScore += opponentRackValue;
    opponentScore -= opponentRackValue;
    winnerUserId = myScore === opponentScore ? null : myScore > opponentScore ? userId : opponentId;
  }

  await prisma.$transaction([
    prisma.scrabbleGame.update({
      where: { id: gameId },
      data: {
        board: JSON.stringify(board),
        bag: JSON.stringify(bag),
        ...(isPlayer1
          ? { player1Rack: JSON.stringify(newRack), player1Score: myScore, player2Score: opponentScore }
          : { player2Rack: JSON.stringify(newRack), player2Score: myScore, player1Score: opponentScore }),
        turnUserId: finished ? null : opponentId,
        consecutivePasses: 0,
        status: finished ? "FINISHED" : "ACTIVE",
        winnerUserId: finished ? winnerUserId : null,
      },
    }),
    prisma.scrabbleMove.create({
      data: {
        gameId,
        userId,
        type: "PLACE",
        tilesPlaced: JSON.stringify(placements),
        wordsFormed: JSON.stringify(validation.result.words.map((w) => w.word)),
        score: validation.result.score,
      },
    }),
    // Eén gedeeld hint-tegoed (User.hintBalance) i.p.v. een los per-partij
    // tegoed — zie scrabbleHint hieronder voor dezelfde reden.
    prisma.user.update({ where: { id: userId }, data: { hintBalance: { increment: 1 } } }),
  ]);

  const myName = isPlayer1 ? game.player1.handle : game.player2.handle;
  const opponentName = isPlayer1 ? game.player2.handle : game.player1.handle;
  if (finished) {
    const tied = winnerUserId === null;
    await Promise.allSettled([
      notifyScrabbleFinished(userId, opponentName, winnerUserId === userId, tied),
      notifyScrabbleFinished(opponentId, myName, winnerUserId === opponentId, tied),
    ]);
    await awardScrabbleCompetitionXp(winnerUserId, game.player1Id, game.player2Id);
  } else {
    notifyScrabbleYourTurn(opponentId, myName).catch(() => {});
  }

  return { ok: true, score: validation.result.score, wordsFormed: validation.result.words.map((w) => w.word) };
}

export async function exchangeTiles(gameId: string, userId: string, letters: string[]): Promise<ActionResult> {
  const game = await prisma.scrabbleGame.findUnique({
    where: { id: gameId },
    include: { player1: true, player2: true },
  });
  if (!game) return { ok: false, error: "Spel niet gevonden." };
  if (game.status !== "ACTIVE") return { ok: false, error: "Dit spel is niet actief." };
  if (game.turnUserId !== userId) return { ok: false, error: "Jij bent niet aan de beurt." };
  const isPlayer1 = userId === game.player1Id;
  if (!isPlayer1 && userId !== game.player2Id) return { ok: false, error: "Je speelt niet mee in dit spel." };
  if (letters.length === 0) return { ok: false, error: "Kies minstens één letter om te wisselen." };

  const bag = parseRack(game.bag);
  // Officiële regel: wisselen mag alleen als de zak nog minstens een vol
  // rek aan stenen bevat (anders zou je opponent onevenredig veel invloed
  // krijgen op wat er straks nog te trekken valt).
  if (bag.length < RACK_SIZE) {
    return { ok: false, error: "Er zitten te weinig letters meer in de zak om te wisselen." };
  }

  const rack = parseRack(isPlayer1 ? game.player1Rack : game.player2Rack);
  const rackAfterConsume = consumeFromRack(
    rack,
    letters.map((l) => ({ letter: l === BLANK ? "" : l, isBlank: l === BLANK }))
  );
  if (!rackAfterConsume) return { ok: false, error: "Je hebt deze letters niet op je rek." };

  const shuffledBag = shuffle([...bag, ...letters]);
  const { drawn, remaining } = drawTiles(shuffledBag, letters.length);
  const newRack = [...rackAfterConsume, ...drawn];

  const opponentId = isPlayer1 ? game.player2Id : game.player1Id;

  await prisma.$transaction([
    prisma.scrabbleGame.update({
      where: { id: gameId },
      data: {
        bag: JSON.stringify(remaining),
        ...(isPlayer1 ? { player1Rack: JSON.stringify(newRack) } : { player2Rack: JSON.stringify(newRack) }),
        turnUserId: opponentId,
        consecutivePasses: { increment: 1 },
      },
    }),
    prisma.scrabbleMove.create({ data: { gameId, userId, type: "EXCHANGE", score: 0 } }),
  ]);

  const myName = isPlayer1 ? game.player1.handle : game.player2.handle;
  notifyScrabbleYourTurn(opponentId, myName).catch(() => {});
  return { ok: true };
}

export async function passTurn(gameId: string, userId: string): Promise<ActionResult> {
  const game = await prisma.scrabbleGame.findUnique({
    where: { id: gameId },
    include: { player1: true, player2: true },
  });
  if (!game) return { ok: false, error: "Spel niet gevonden." };
  if (game.status !== "ACTIVE") return { ok: false, error: "Dit spel is niet actief." };
  if (game.turnUserId !== userId) return { ok: false, error: "Jij bent niet aan de beurt." };
  const isPlayer1 = userId === game.player1Id;
  if (!isPlayer1 && userId !== game.player2Id) return { ok: false, error: "Je speelt niet mee in dit spel." };

  const opponentId = isPlayer1 ? game.player2Id : game.player1Id;
  const newPassCount = game.consecutivePasses + 1;
  const finished = newPassCount >= PASS_LIMIT;

  let winnerUserId: string | null = null;
  if (finished) {
    winnerUserId =
      game.player1Score === game.player2Score ? null : game.player1Score > game.player2Score ? game.player1Id : game.player2Id;
  }

  await prisma.$transaction([
    prisma.scrabbleGame.update({
      where: { id: gameId },
      data: {
        turnUserId: finished ? null : opponentId,
        consecutivePasses: newPassCount,
        status: finished ? "FINISHED" : "ACTIVE",
        winnerUserId: finished ? winnerUserId : undefined,
      },
    }),
    prisma.scrabbleMove.create({ data: { gameId, userId, type: "PASS", score: 0 } }),
  ]);

  const myName = isPlayer1 ? game.player1.handle : game.player2.handle;
  const opponentName = isPlayer1 ? game.player2.handle : game.player1.handle;
  if (finished) {
    const tied = winnerUserId === null;
    await Promise.allSettled([
      notifyScrabbleFinished(userId, opponentName, winnerUserId === userId, tied),
      notifyScrabbleFinished(opponentId, myName, winnerUserId === opponentId, tied),
    ]);
    await awardScrabbleCompetitionXp(winnerUserId, game.player1Id, game.player2Id);
  } else {
    notifyScrabbleYourTurn(opponentId, myName).catch(() => {});
  }
  return { ok: true };
}

/**
 * Opgeven — mag altijd, ook als je niet aan de beurt bent (in
 * tegenstelling tot plaatsen/wisselen/passen, die alleen mogen als
 * turnUserId === userId). De ander wordt direct winnaar, ongeacht scores.
 */
export async function forfeitGame(gameId: string, userId: string): Promise<ActionResult> {
  const game = await prisma.scrabbleGame.findUnique({
    where: { id: gameId },
    include: { player1: true, player2: true },
  });
  if (!game) return { ok: false, error: "Spel niet gevonden." };
  if (game.status !== "ACTIVE") return { ok: false, error: "Dit spel is niet actief." };
  const isPlayer1 = userId === game.player1Id;
  if (!isPlayer1 && userId !== game.player2Id) return { ok: false, error: "Je speelt niet mee in dit spel." };

  const opponentId = isPlayer1 ? game.player2Id : game.player1Id;
  const myName = isPlayer1 ? game.player1.handle : game.player2.handle;
  const opponentName = isPlayer1 ? game.player2.handle : game.player1.handle;

  await prisma.$transaction([
    prisma.scrabbleGame.update({
      where: { id: gameId },
      data: { status: "FINISHED", winnerUserId: opponentId, turnUserId: null },
    }),
    prisma.scrabbleMove.create({ data: { gameId, userId, type: "FORFEIT", score: 0 } }),
  ]);

  await Promise.allSettled([
    notifyScrabbleFinished(opponentId, myName, true, false),
    notifyScrabbleFinished(userId, opponentName, false, false),
  ]);
  // Alleen de winnaar krijgt iets — wie opgeeft, verdient (net als bij het
  // opgeven van Raad het hoofdstuk) geen enkele beloning, ook geen
  // deelname-XP.
  await prisma
    .$transaction(async (tx) => {
      await awardCompetitionXp(tx, opponentId, "SCRABBLE_WON", SCRABBLE_WIN_XP);
    })
    .catch(() => {});
  return { ok: true };
}

export interface HintActionResult {
  ok: boolean;
  error?: string;
  word?: string;
  usedIndices?: number[];
  hintBalance?: number;
}

/**
 * Hint gebruiken — mag altijd, ook als je niet aan de beurt bent (je vraagt
 * iets over je EIGEN rek, dat verandert niet buiten je beurt om). Kost één
 * hint-tegoed, dat je verdient door zelf een woord te spelen (zie
 * placeMove hierboven). Geen tegoed of geen spelbaar woord gevonden? Dan
 * wordt er niets afgeschreven.
 */
export async function scrabbleHint(gameId: string, userId: string): Promise<HintActionResult> {
  const game = await prisma.scrabbleGame.findUnique({ where: { id: gameId } });
  if (!game) return { ok: false, error: "Spel niet gevonden." };
  if (game.status !== "ACTIVE") return { ok: false, error: "Dit spel is niet actief." };
  const isPlayer1 = userId === game.player1Id;
  if (!isPlayer1 && userId !== game.player2Id) return { ok: false, error: "Je speelt niet mee in dit spel." };

  const rack = parseRack(isPlayer1 ? game.player1Rack : game.player2Rack);
  const hint = findHint(rack);
  if (!hint) {
    return { ok: false, error: "Geen woord gevonden met je huidige letters." };
  }

  // Eén gedeeld hint-tegoed (User.hintBalance, zie src/lib/shop.ts) —
  // overal inzetbaar, niet aan dit spel gebonden. De `gt: 0`-voorwaarde
  // maakt dit race-veilig bij gelijktijdige aanvragen (bv. een dubbelklik):
  // als een andere aanvraag het tegoed ondertussen al heeft opgemaakt,
  // matcht de WHERE niet meer en is affected rows 0, in plaats van dat
  // beide aanvragen op basis van een verouderde lezing allebei doorgaan.
  const userCreditResult = await prisma.user.updateMany({
    where: { id: userId, hintBalance: { gt: 0 } },
    data: { hintBalance: { decrement: 1 } },
  });
  if (userCreditResult.count === 0) {
    return { ok: false, error: "Je hebt geen hint beschikbaar — speel eerst een woord, of koop er een in de winkel." };
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true } });
  return { ok: true, word: hint.word, usedIndices: hint.usedIndices, hintBalance: user.hintBalance };
}
