import { lockUsers } from "@/lib/social/common";
import { emitToUser } from "@/lib/realtime";
import { prisma } from "@/lib/db";
import { awardXp } from "@/lib/xp";
import { applyWeeklyXp } from "@/lib/leagues";

// Eerste (en vooralsnog enige) artikel in de winkel: een hint, inwisselbaar
// tegen XP. User.hintBalance is het enige hint-tegoed dat er is — gekocht
// hier of verdiend bij het Woordspel/Raad het hoofdstuk komt op dezelfde
// plek terecht, zodat overal waar hints te gebruiken zijn precies hetzelfde
// getal te zien is.
export const HINT_PRICE_XP = 50;

export type BuyHintResult =
  | { ok: true; xpTotal: number; hintBalance: number }
  | { ok: false; error: string };

export async function buyHints(userId: string, quantity: number): Promise<BuyHintResult> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, error: "Ongeldig aantal." };
  }
  const cost = quantity * HINT_PRICE_XP;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockUsers(tx, [userId]);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.xpTotal < cost) {
        throw new InsufficientXpError();
      }
      await awardXp(tx, userId, -cost, "HINT_PURCHASED", { quantity });
      // Zonder dit bleef de divisiestand (WeeklyScore) op het oude, hogere
      // XP-bedrag staan na een aankoop — die wordt normaal alleen door
      // les-achtige "complete*"-functies in streak.ts bijgewerkt.
      await applyWeeklyXp(tx, userId, -cost);
      return tx.user.update({
        where: { id: userId },
        data: { hintBalance: { increment: quantity } },
      });
    });
    emitToUser(userId, "hints_changed");
    return { ok: true, xpTotal: updated.xpTotal, hintBalance: updated.hintBalance };
  } catch (e) {
    if (e instanceof InsufficientXpError) {
      return { ok: false, error: `Je hebt niet genoeg XP (${cost} nodig).` };
    }
    throw e;
  }
}

// Tweede artikel in de winkel: een streak freeze, ook inwisselbaar tegen
// XP. Los van de freezes die je verdient op een streak-/hoofdstuk-mijlpaal
// (zie recordLearningActivity in src/lib/streak.ts en submitExerciseSession
// in src/lib/learning/contentProgress.ts) of cadeau krijgt van een
// vriend (giftFreeze) — dit is gewoon een derde manier om aan User.freezeCount
// te komen, en telt daarom net als die andere twee mee in een eigen
// FreezeTransaction voor de audittrail.
export const FREEZE_PRICE_XP = 500;

export type BuyFreezeResult =
  | { ok: true; xpTotal: number; freezeCount: number }
  | { ok: false; error: string };

export async function buyFreezes(userId: string, quantity: number): Promise<BuyFreezeResult> {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, error: "Ongeldig aantal." };
  }
  const cost = quantity * FREEZE_PRICE_XP;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockUsers(tx, [userId]);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.xpTotal < cost) {
        throw new InsufficientXpError();
      }
      await awardXp(tx, userId, -cost, "FREEZE_PURCHASED", { quantity });
      await applyWeeklyXp(tx, userId, -cost);
      await tx.freezeTransaction.create({
        data: { userId, type: "PURCHASED", amount: quantity, reason: "Gekocht in de winkel" },
      });
      return tx.user.update({
        where: { id: userId },
        data: { freezeCount: { increment: quantity } },
      });
    });
    return { ok: true, xpTotal: updated.xpTotal, freezeCount: updated.freezeCount };
  } catch (e) {
    if (e instanceof InsufficientXpError) {
      return { ok: false, error: `Je hebt niet genoeg XP (${cost} nodig).` };
    }
    throw e;
  }
}

class InsufficientXpError extends Error {}
