import { readingAccessWhere } from "@/lib/contentAccess";
import { getContentContext } from "@/lib/contentCollections";
import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { notifyChallengeReceived } from "@/lib/notify";
import { apiError } from "@/lib/apiError";

const createSchema = z.object({
  friendUserId: z.string().trim().min(1),
  chapterId: z.string().trim().min(1),
}).strict();

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const challenges = await prisma.challenge.findMany({
    where: { OR: [{ senderId: user.id }, { receiverId: user.id }] },
    orderBy: { createdAt: "desc" },
    include: {
      sender: { select: { id: true, handle: true, discriminator: true } },
      receiver: { select: { id: true, handle: true, discriminator: true } },
      chapter: { include: { book: true } },
    },
  });

  return NextResponse.json({
    challenges: challenges.map((c) => {
      const isSender = c.senderId === user.id;
      const opponent = isSender ? c.receiver : c.sender;
      const myScore = isSender ? c.senderScore : c.receiverScore;
      const opponentScore = isSender ? c.receiverScore : c.senderScore;
      const myCompletedAt = isSender ? c.senderCompletedAt : c.receiverCompletedAt;
      return {
        id: c.id,
        status: c.status,
        isSender,
        bookName: c.chapter.book.name,
        chapterNumber: c.chapter.number,
        chapterId: c.chapterId,
        opponent: { id: opponent.id, displayName: opponent.handle },
        myScore,
        opponentScore,
        hasPlayed: myCompletedAt !== null,
        won: c.status === "FINISHED" ? c.winnerUserId === user.id : null,
        tied: c.status === "FINISHED" ? c.winnerUserId === null : null,
        createdAt: c.createdAt,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "challenges");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const { friendUserId, chapterId } = parsed.data;

  if (friendUserId === user.id) {
    return await apiError("apiErrors.cantChallengeSelf", 400);
  }

  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { senderId: user.id, receiverId: friendUserId },
        { senderId: friendUserId, receiverId: user.id },
      ],
    },
  });
  if (!friendship) {
    return await apiError("apiErrors.challengeFriendsOnly", 400);
  }

  const context = await getContentContext(user.id);
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, book: { contentCollectionId: context.active.id, contentCollection: readingAccessWhere(user) }, exercises: { some: { status: "APPROVED" } } }, include: { book: true } });
  if (!chapter) return await apiError("apiErrors.chapterNotFoundDot", 404);

  const challenge = await prisma.challenge.create({
    data: { senderId: user.id, receiverId: friendUserId, chapterId, status: "PENDING" },
  });

  notifyChallengeReceived(friendUserId, user.handle, chapter.book.name, chapter.number).catch(() => {});

  return NextResponse.json({ id: challenge.id });
}
