import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getFriendStatusMap } from "@/lib/presence";
import { apiError } from "@/lib/apiError";
import { nudgeAvailability, nudgesDisabled } from "@/lib/social/nudges";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const friendships = await prisma.friendship.findMany({
    where: { OR: [{ senderId: user.id }, { receiverId: user.id }] },
    include: {
      // Persoonlijke prestaties horen uitsluitend thuis achter de expliciete
      // privacycontrole van /api/friends/profiles/[userId].
      sender: { select: { id: true, handle: true, discriminator: true, avatarEmoji: true } },
      receiver: { select: { id: true, handle: true, discriminator: true, avatarEmoji: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const friends = friendships
    .filter((f) => f.status === "ACCEPTED")
    .map((f) => ({
      friendshipId: f.id,
      user: f.senderId === user.id ? f.receiver : f.sender,
    }));

  const incoming = friendships
    .filter((f) => f.status === "PENDING" && f.receiverId === user.id)
    .map((f) => ({ friendshipId: f.id, from: f.sender }));

  const outgoing = friendships
    .filter((f) => f.status === "PENDING" && f.senderId === user.id)
    .map((f) => ({ friendshipId: f.id, to: f.receiver }));

  // Statusinformatie wordt hier per vriend berekend op basis van DIENS eigen
  // instellingen (zie computeFriendStatus in src/lib/presence.ts) — een
  // vriend die niets deelt komt hier gewoon niet in de map voor, in plaats
  // van met een "verborgen" waarde, zodat er ook via deze route niets lekt.
  const statusByUserId = await getFriendStatusMap(friends.map((f) => f.user.id), user.shareOnlineStatus);

  // Seintjes: wanneer kan het weer, en wie heeft ze uitgezet (dan geen knop).
  const friendIds = friends.map((f) => f.user.id);
  const [availability, disabled] = await Promise.all([nudgeAvailability(prisma, user.id, friendIds), nudgesDisabled(prisma, friendIds)]);
  const nudge = { availableAt: Object.fromEntries(availability), disabled: [...disabled] };

  return NextResponse.json({ friends, incoming, outgoing, statusByUserId, nudge });
}
