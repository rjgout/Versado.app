import type { Prisma } from "@/generated/prisma/client";
import headings from "../../../prisma/bomChapterHeadings.json";
import { BOOK_KEYS_BY_SLUG } from "../../../prisma/bookKeys";
import { contentKeyForChapter } from "@/lib/learning/contentIdentity";
import { CHAPTER_COUNT } from "./geometry";

// De bestaande officiële hoofdstuklijst, met dezelfde identiteit als leesvoortgang.
// Geen prefixmatch: ook niet-bestaande hoofdstukken binnen bofm worden uitgesloten.
export const BOFM_CANONICAL_CONTENT_KEYS = headings.map(([slug, number]) => {
  const bookKey = BOOK_KEYS_BY_SLUG[String(slug)];
  if (!bookKey?.startsWith("bofm/") || !Number.isInteger(number)) throw new Error("DORP_CANON_INVALID");
  return contentKeyForChapter({ id: "", bookKey, number: Number(number) });
});
if (new Set(BOFM_CANONICAL_CONTENT_KEYS).size !== CHAPTER_COUNT) throw new Error("DORP_CANON_INVALID");

export async function countCanonicalReadContributions(
  tx: Pick<Prisma.TransactionClient, "contentProgress">,
  userIds: string[],
): Promise<number> {
  // UNIQUE(userId, contentKey): één bijdrage per canoniek hoofdstuk per lid,
  // onafhankelijk van de laatst gebruikte taaleditie/leesroute/hoofdstuklink.
  return tx.contentProgress.count({ where: {
    userId: { in: userIds }, readStatus: "READ",
    contentKey: { in: BOFM_CANONICAL_CONTENT_KEYS },
  } });
}
