import type { Prisma } from "@/generated/prisma/client";

/** `Friendship` is alleen uniek per richting (senderId, receiverId). Twee gelijktijdige verzoeken A→B en B→A
 * kunnen daarom allebei slagen. Een advisory lock op het geordende paar serialiseert ze zonder schemawijziging;
 * de tweede zet ziet daarna het verzoek van de eerste. De lock vervalt aan het eind van de transactie. */
export async function lockFriendPair(tx: Prisma.TransactionClient, a: string, b: string): Promise<void> {
  const [first, second] = a < b ? [a, b] : [b, a];
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`friendship:${first}:${second}`}, 0))`;
}

export type FriendRequestOutcome =
  | { created: true; id: string }
  | { created: false; existingId: string; status: string };

/** Maakt een verzoek alleen als er in géén van beide richtingen al een relatie bestaat. */
export async function createFriendRequestOnce(tx: Prisma.TransactionClient, senderId: string, receiverId: string): Promise<FriendRequestOutcome> {
  await lockFriendPair(tx, senderId, receiverId);
  const existing = await tx.friendship.findFirst({
    where: { OR: [{ senderId, receiverId }, { senderId: receiverId, receiverId: senderId }] },
    select: { id: true, status: true },
  });
  if (existing) return { created: false, existingId: existing.id, status: existing.status };
  const friendship = await tx.friendship.create({ data: { senderId, receiverId, status: "PENDING" }, select: { id: true } });
  return { created: true, id: friendship.id };
}
