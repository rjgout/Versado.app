import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getContentAvailability } from "@/lib/contentAccess";
import { canStartGame } from "@/lib/gameAvailability";
import { PuzzleServiceError } from "@/lib/puzzle/errors";

// De bestaande kids-catalogus en vragen zijn aantoonbaar vaste BOM-content.
// Scopes of de actuele voorkeur zijn nooit de identiteit van een bestaande partij.
export const PUZZLE_CONTENT_COLLECTION_ID = "content_bom";

export async function requirePuzzleContent(db: Pick<Prisma.TransactionClient, "contentCollection"> = prisma) {
  if (!await getContentAvailability({ isAdmin: false }, PUZZLE_CONTENT_COLLECTION_ID, "read", db)) throw new PuzzleServiceError("FORBIDDEN");
}

export async function requireNewPuzzleStart(userId: string) {
  if (!await canStartGame(userId, "jigsaw")) throw new PuzzleServiceError("FORBIDDEN");
}
