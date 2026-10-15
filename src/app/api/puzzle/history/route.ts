import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HISTORY_MAX_PAGE_SIZE, HISTORY_PAGE_SIZE, decodeCursor, listFinishedPuzzles } from "@/lib/puzzle/history";
import { puzzleRouteUser } from "@/lib/puzzle/routeGuard";

// De volledige geschiedenis van afgeronde gezamenlijke puzzels en wedstrijden van de ingelogde gebruiker, de nieuwste eerst, met
// cursorpaginatie. Alleen eigen gegevens: de query filtert altijd op deelname van de gebruiker, een cursor geeft nooit extra toegang.
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(HISTORY_MAX_PAGE_SIZE).optional(),
  cursor: z.string().max(200).optional(),
});

export async function GET(req: NextRequest) {
  const guard = await puzzleRouteUser(); if ("response" in guard) return guard.response;
  const { user, t } = guard;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400 });
  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400 });
  const page = await listFinishedPuzzles(user.id, { limit: parsed.data.limit ?? HISTORY_PAGE_SIZE, cursor });
  return NextResponse.json({ meId: user.id, ...page });
}
