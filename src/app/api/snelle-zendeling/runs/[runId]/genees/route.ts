import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { buyGeneesInRun } from "@/lib/snelleZendeling/runs";

// In-game noodkoop: na de gratis Genees en met lege voorraad, maximaal één keer
// per run. Alle regels (eenmalig, prijs, saldo) controleert de server in runs.ts.
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  try {
    const { result, view } = await buyGeneesInRun((await params).runId, user.id);
    if (!result.ok) {
      if (result.error === "INSUFFICIENT_XP") return await apiError("quickMissionary.healBuyNotEnough", 400, { xp: result.priceXp ?? 0 });
      if (result.error === "PURCHASE_LIMIT") return await apiError("quickMissionary.purchaseLimit", 409);
      if (result.error === "NO_QUESTIONS") return await apiError("quickMissionary.noQuestion", 409);
      return await apiError("apiErrors.invalidInput", 409);
    }
    return NextResponse.json(view);
  } catch {
    return await apiError("apiErrors.invalidInput", 404);
  }
}
