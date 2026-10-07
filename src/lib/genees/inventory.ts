import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { awardXp } from "@/lib/xp";
import { applyWeeklyXp } from "@/lib/leagues";
import { geneesPriceXp } from "@/lib/genees/pricing";

// Genees-voorraad en -aankoop. Eén plek voor het wijzigen van
// User.geneesBalance; de XP loopt via de gewone XP-ledger (awardXp) en de
// divisiestand (applyWeeklyXp), precies zoals de andere winkelartikelen in
// src/lib/shop.ts. Server is de enige autoriteit: prijs en saldo komen uit de
// database, nooit van de client.
//
// Samenloop: elke aankoop neemt eerst een rijvergrendeling op de gebruiker
// (SELECT ... FOR UPDATE). Twee apparaten of een dubbele klik wachten dus op
// elkaar, zien daarna de nieuwe voorraad (en dus de nieuwe prijs) en kunnen het
// XP-saldo niet onder nul brengen. De voorraad heeft bovendien een
// CHECK-constraint (>= 0) als laatste vangnet.

export type BuyGeneesError = "INSUFFICIENT_XP" | "NOT_FOUND" | "INVALID_STATE" | "PURCHASE_LIMIT" | "NO_QUESTIONS";

export type BuyGeneesResult =
  | { ok: true; xpTotal: number; geneesBalance: number; priceXp: number; nextPriceXp: number; duplicate: boolean }
  | { ok: false; error: BuyGeneesError; priceXp?: number };

type Tx = Prisma.TransactionClient;

export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}

/** Schrijft de aankoop weg: XP-afschrijving, divisiestand, voorraad en audit, in de aanroepende transactie. */
export async function applyGeneesPurchase(
  tx: Tx,
  userId: string,
  options: { source: "SHOP" | "GAME"; runId?: string; idempotencyKey?: string }
): Promise<BuyGeneesResult> {
  // De gebruiker is hier al vergrendeld (lockUser) door de aanroeper.
  const user = await tx.user.findUnique({ where: { id: userId }, select: { xpTotal: true, geneesBalance: true } });
  if (!user) return { ok: false, error: "NOT_FOUND" };
  const priceXp = geneesPriceXp(user.geneesBalance);
  if (user.xpTotal < priceXp) return { ok: false, error: "INSUFFICIENT_XP", priceXp };

  await awardXp(tx, userId, -priceXp, "GENEES_PURCHASED", { priceXp, stockBefore: user.geneesBalance, source: options.source, runId: options.runId });
  // Een aankoop telt ook in de wekelijkse divisiestand (zie src/lib/shop.ts).
  await applyWeeklyXp(tx, userId, -priceXp);
  const updated = await tx.user.update({ where: { id: userId }, data: { geneesBalance: { increment: 1 } }, select: { xpTotal: true, geneesBalance: true } });
  await tx.geneesPurchase.create({
    data: { userId, priceXp, stockBefore: user.geneesBalance, source: options.source, runId: options.runId, idempotencyKey: options.idempotencyKey },
  });
  return { ok: true, xpTotal: updated.xpTotal, geneesBalance: updated.geneesBalance, priceXp, nextPriceXp: geneesPriceXp(updated.geneesBalance), duplicate: false };
}

/**
 * Winkelaankoop: één Genees per aanroep (de prijs hangt van de voorraad af, dus
 * meerdere kopen is meerdere aanroepen met stijgende prijs). `idempotencyKey`
 * laat een herhaald verzoek (netwerkherhaling, dubbele klik) hetzelfde resultaat
 * geven zonder opnieuw af te schrijven.
 */
export async function buyGeneesInShop(userId: string, idempotencyKey?: string): Promise<BuyGeneesResult> {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    if (idempotencyKey) {
      const earlier = await tx.geneesPurchase.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
      if (earlier) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { xpTotal: true, geneesBalance: true } });
        return { ok: true as const, xpTotal: user.xpTotal, geneesBalance: user.geneesBalance, priceXp: earlier.priceXp, nextPriceXp: geneesPriceXp(user.geneesBalance), duplicate: true };
      }
    }
    return applyGeneesPurchase(tx, userId, { source: "SHOP", idempotencyKey });
  });
}

export interface GeneesShopState {
  xpTotal: number;
  geneesBalance: number;
  geneesPriceXp: number;
}

export async function getGeneesShopState(userId: string): Promise<GeneesShopState> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { xpTotal: true, geneesBalance: true } });
  return { xpTotal: user.xpTotal, geneesBalance: user.geneesBalance, geneesPriceXp: geneesPriceXp(user.geneesBalance) };
}
