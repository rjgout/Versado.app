import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listOwnRecords } from "@/lib/puzzle/records";
import { puzzleRouteUser } from "@/lib/puzzle/routeGuard";
import { difficultySchema } from "@/lib/puzzle/schemas";

// Eigen persoonlijke beste tijden. Altijd alleen van de ingelogde gebruiker, dus onafhankelijk van privacy-instellingen;
// nooit gecachet (private, no-store) zodat er geen gegevens tussen gebruikers kunnen lekken.
const query = z.object({
  mode: z.enum(["SOLO", "MATCH"]).optional(),
  hintCategory: z.enum(["NO_HINTS", "WITH_HINTS"]).optional(),
  pieceCount: z.coerce.number().int().refine((n) => [6, 12, 24, 48, 96].includes(n)).optional(),
  difficulty: difficultySchema.optional(),
});

export async function GET(req: NextRequest) {
  const guard = await puzzleRouteUser(); if ("response" in guard) return guard.response;
  const { user, t } = guard;
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ records: await listOwnRecords(user.id, parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
}
