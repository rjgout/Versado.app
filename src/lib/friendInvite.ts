import { randomBytes } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { notifyInviteAccepted } from "@/lib/notify";
import { lockFriendPair } from "@/lib/social/friendshipPair";

// Persoonlijke uitnodigingslinks: /uitnodiging/<code>. De link zelf is de
// toestemming van de uitnodiger, de klik (een account maken of "Word
// vrienden") die van de ander; daarom wordt de vriendschap meteen ACCEPTED,
// zonder verzoek ertussen.

// 6 bytes = 8 tekens base64url, 48 bits: ondoenlijk om te raden, kort genoeg
// voor een link in een appje.
const CODE_BYTES = 6;
const CODE_PATTERN = /^[A-Za-z0-9_-]{8}$/;
const MAX_ATTEMPTS = 5;

export const INVALID_INVITE_ERROR = "Deze uitnodigingslink is niet (meer) geldig.";

function newCode(): string {
  return randomBytes(CODE_BYTES).toString("base64url");
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function getOrCreateInviteCode(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { inviteCode: true } });
  if (user.inviteCode) return user.inviteCode;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Alleen zetten als er nog geen is: twee tabbladen die tegelijk voor het
      // eerst laden, krijgen zo dezelfde code in plaats van dat de ene de
      // link van de andere ongeldig maakt.
      await prisma.user.updateMany({ where: { id: userId, inviteCode: null }, data: { inviteCode: newCode() } });
      const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { inviteCode: true } });
      if (updated.inviteCode) return updated.inviteCode;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("Kon geen unieke uitnodigingscode maken.");
}

export async function regenerateInviteCode(userId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = newCode();
    try {
      await prisma.user.update({ where: { id: userId }, data: { inviteCode: code } });
      return code;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("Kon geen unieke uitnodigingscode maken.");
}

export async function findInviter(code: string) {
  if (!CODE_PATTERN.test(code)) return null;
  return prisma.user.findUnique({
    where: { inviteCode: code },
    select: { id: true, handle: true, discriminator: true, avatarEmoji: true },
  });
}

export type InviteResult =
  | { ok: true; inviterId: string; alreadyFriends: boolean }
  | { ok: false; error: string };

/**
 * Maakt `userId` bevriend met de eigenaar van de link. Een openstaand of
 * eerder geweigerd verzoek tussen beiden wordt daarbij omgezet: allebei
 * hebben nu immers ja gezegd.
 */
export async function becomeFriendsViaInvite(
  code: string,
  userId: string,
  { isNewAccount }: { isNewAccount: boolean }
): Promise<InviteResult> {
  const inviter = await findInviter(code);
  if (!inviter) return { ok: false, error: INVALID_INVITE_ERROR };
  if (inviter.id === userId) return { ok: false, error: "Dit is je eigen uitnodigingslink." };

  // Zoeken en schrijven onder één paarvergrendeling, zodat een gelijktijdig verzoek in de andere richting geen tweede rij maakt.
  const alreadyFriends = await prisma.$transaction(async (tx) => {
    await lockFriendPair(tx, inviter.id, userId);
    const existing = await tx.friendship.findFirst({
      where: {
        OR: [
          { senderId: inviter.id, receiverId: userId },
          { senderId: userId, receiverId: inviter.id },
        ],
      },
    });
    if (existing?.status === "ACCEPTED") return true;
    if (existing) {
      await tx.friendship.update({ where: { id: existing.id }, data: { status: "ACCEPTED" } });
    } else {
      await tx.friendship.create({ data: { senderId: inviter.id, receiverId: userId, status: "ACCEPTED" } });
    }
    await checkAndAwardAchievements(tx, inviter.id);
    await checkAndAwardAchievements(tx, userId);
    return false;
  });
  if (alreadyFriends) return { ok: true, inviterId: inviter.id, alreadyFriends: true };

  const friend = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true } });
  if (friend) notifyInviteAccepted(inviter.id, friend.handle, isNewAccount).catch(() => {});
  return { ok: true, inviterId: inviter.id, alreadyFriends: false };
}
