import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jigsawCatalog } from "@/lib/jigsawGame";
import { findVariant, friendLeaderboard } from "@/lib/puzzle/records";
import { puzzleRouteUser } from "@/lib/puzzle/routeGuard";
import { difficultySchema, idSchema } from "@/lib/puzzle/schemas";

// Vriendenranglijst voor één exacte puzzelvariant, modus en hintcategorie. De server bepaalt de toegestane
// gebruikers (de kijker en geaccepteerde vrienden die delen aan hebben); er is geen parameter waarmee een client
// gebruikers kan toevoegen. Geen wereldwijde of groepsranglijst.
const base = { mode: z.enum(["SOLO", "MATCH"]), hintCategory: z.enum(["NO_HINTS", "WITH_HINTS"]) };
const query = z.union([
  z.object({ variantId: idSchema, ...base }),
  z.object({ imageId: z.string().refine((id) => jigsawCatalog.some((item) => item.url === id)), pieceCount: z.coerce.number().int().refine((n) => [6, 12, 24, 48, 96].includes(n)), difficulty: difficultySchema, ...base }),
]);
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(req: NextRequest) {
  const guard = await puzzleRouteUser(); if ("response" in guard) return guard.response;
  const { user, t } = guard;
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400, headers });
  const input = parsed.data;
  const variant = "variantId" in input ? await findVariant({ variantId: input.variantId }) : await findVariant({ imageUrl: input.imageId, pieceCount: input.pieceCount, difficulty: input.difficulty });
  // Een onbekende variant geeft dezelfde neutrale lege uitkomst, zonder interne gegevens of een foutdetail.
  if (!variant) return NextResponse.json({ leaderboard: null }, { headers });
  return NextResponse.json({ leaderboard: await friendLeaderboard(user.id, variant.id, input.mode, input.hintCategory) }, { headers });
}
