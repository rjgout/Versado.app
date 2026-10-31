import { prisma } from "@/lib/db";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { commitAccountMutation, type AccountActor } from "@/lib/account/mutation";
import { emitToUser } from "@/lib/realtime";
export class FriendRequestError extends Error {
  constructor(readonly code: "request_not_found" | "request_state_changed", readonly status = code === "request_not_found" ? 404 : 409) { super(code); }
}
/** Dezelfde webdomeinactie; alleen een ontvanger accepteert. Web mag een eigen
 * uitgaand PENDING-verzoek annuleren. Afwijzen is zoals voorheen verwijderen:
 * herhaling levert 404, nooit een nieuwe write, prestatie of melding.
 */
export async function respondFriendRequest(actor: AccountActor, friendshipId: string, action: "accept" | "decline", allowSenderCancel = false) {
  const known = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  const authorized = (f: typeof known) => !!f && (f.receiverId === actor.userId || action === "decline" && allowSenderCancel && f.senderId === actor.userId);
  if (!authorized(known) || !known) throw new FriendRequestError("request_not_found");
  const result = await commitAccountMutation(actor, [known.senderId, known.receiverId], async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Friendship" WHERE "id" = ${friendshipId} FOR UPDATE`;
    const current = await tx.friendship.findUnique({ where: { id: friendshipId } });
    if (!authorized(current) || !current) throw new FriendRequestError("request_not_found");
    if (action === "accept" && current.status === "ACCEPTED") return { status: "accepted" as const, changed: false };
    if (current.status !== "PENDING") throw new FriendRequestError("request_state_changed");
    if (action === "decline") {
      await tx.friendship.delete({ where: { id: friendshipId } });
      return { status: "declined" as const, changed: true };
    }
    await tx.friendship.update({ where: { id: friendshipId }, data: { status: "ACCEPTED" } });
    for (const id of [...new Set([current.senderId, current.receiverId])].sort()) await checkAndAwardAchievements(tx, id);
    return { status: "accepted" as const, changed: true };
  });
  if (result.changed) for (const id of [known.senderId, known.receiverId]) emitToUser(id, "friends_changed");
  return result;
}
