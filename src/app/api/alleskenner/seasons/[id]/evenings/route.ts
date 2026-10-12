import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { createAlleskennerGame } from "@/lib/alleskenner/game";
import { isSeasonManager, loadSeasonFor, openEvening, planEvening } from "@/lib/alleskenner/season";
import { apiError, apiErrorText } from "@/lib/apiError";

const schema = z.object({ absentIds: z.array(z.string()).max(200) });

// Start een seizoensavond: de opstelling wordt hier vastgelegd (met de
// afwezigen die de host aanvinkt), daarna gaat iedereen naar de lobby. Leden
// krijgen hun uitnodiging zodra de host de lobby opent (src/server/alleskenner.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const { id } = await params;
  const season = await loadSeasonFor(id, user.id);
  if (!season) return await apiError("apiErrors.seasonNotFound", 404);
  if (!isSeasonManager(season, user.id)) return await apiError("apiErrors.hostOnlyEvening", 403);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInputDot", 400);

  // Er loopt al een avond: daarheen, in plaats van een tweede.
  const open = openEvening(season.evenings);
  if (open) return NextResponse.json({ code: open.game!.code });

  const denied = await gameStartGuard(req, user.id, "alleskenner");
  if (denied) return denied;
  const plan = planEvening(season, season.members, parsed.data.absentIds);
  if (plan.error) return await apiErrorText(plan.error, 409);

  // Oude, nooit gespeelde avonden (lobby geannuleerd) netjes afsluiten.
  await prisma.alleskennerEvening.updateMany({ where: { seasonId: id, status: "PLANNED" }, data: { status: "CANCELLED" } });
  const number = season.evenings.filter((e) => e.status === "DONE").length + 1;
  const game = await createAlleskennerGame(user.id);
  await prisma.alleskennerEvening.create({
    data: {
      seasonId: id,
      number,
      isFinale: plan.isFinale,
      isLast: plan.isLast,
      gameId: game.id,
      lineup: JSON.stringify(plan.lineup),
      newcomers: JSON.stringify(plan.newcomers),
    },
  });
  return NextResponse.json({ code: game.code });
}
