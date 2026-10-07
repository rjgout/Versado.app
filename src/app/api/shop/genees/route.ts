import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { buyGeneesInShop } from "@/lib/genees/inventory";
import { apiError } from "@/lib/apiError";

// Eén Genees per aanroep: de prijs hangt van de voorraad af (100 + voorraad × 25),
// dus meerdere kopen is meerdere aanroepen met een stijgende prijs. De prijs en
// het saldo bepaalt de server; de optionele idempotencyKey vangt een dubbele klik
// of netwerkherhaling op.
const schema = z.object({ idempotencyKey: z.string().min(8).max(64).optional() });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const result = await buyGeneesInShop(user.id, parsed.data.idempotencyKey);
  if (!result.ok) {
    if (result.error === "INSUFFICIENT_XP") return await apiError("serverTexts.notEnoughXp", 400, { cost: result.priceXp ?? 0 });
    return await apiError("apiErrors.invalidInput", 400);
  }
  return NextResponse.json({ xpTotal: result.xpTotal, geneesBalance: result.geneesBalance, priceXp: result.priceXp, nextPriceXp: result.nextPriceXp });
}
