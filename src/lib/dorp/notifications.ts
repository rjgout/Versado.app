import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";

/** Alleen na commit; geen dorp-/profielinhoud in realtime-payloads. */
export async function notifyVillagePrivacyChanged(ownerId: string) {
  const friends = await prisma.friendship.findMany({ where: { status: "ACCEPTED", OR: [
    { senderId: ownerId }, { receiverId: ownerId },
  ] }, select: { senderId: true, receiverId: true } });
  const users = new Set([ownerId, ...friends.flatMap(f => [f.senderId, f.receiverId])]);
  for (const userId of users) emitToUser(userId, DATA_EVENT_SOCKET_NAME, { event: "dorpAccessChanged" });
}
