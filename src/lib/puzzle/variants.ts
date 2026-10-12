import { prisma } from "@/lib/db";
import { definitionFor } from "@/lib/puzzle/solo";
import { PUZZLE_RULES_VERSION, type PuzzleDifficulty, type PuzzlePieceCount } from "@/lib/puzzle/types";

/** Dezelfde definitie- en variantentabellen als Solo: geen tweede catalogus. */
export async function ensureVariant(content: number | string, pieceCount: PuzzlePieceCount, difficulty: PuzzleDifficulty) {
  const definition = await definitionFor(content);
  const key = { definitionId: definition.id, pieceCount, difficulty, rulesVersion: PUZZLE_RULES_VERSION };
  await prisma.puzzleVariant.createMany({ data: [key], skipDuplicates: true });
  const variant = await prisma.puzzleVariant.findUniqueOrThrow({ where: { definitionId_pieceCount_difficulty_rulesVersion: key } });
  return { definition, variant };
}

export async function areAcceptedFriends(db: { friendship: typeof prisma.friendship }, a: string, b: string): Promise<boolean> {
  const row = await db.friendship.findFirst({
    where: { status: "ACCEPTED", OR: [{ senderId: a, receiverId: b }, { senderId: b, receiverId: a }] },
    select: { id: true },
  });
  return row !== null;
}
