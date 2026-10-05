import { prisma } from "@/lib/db";
import { hintFor } from "./logic";
import type { MysteryDefinition, Placements } from "./types";

/**
 * Mysteries gebruiken hetzelfde hinttegoed als de andere leeractiviteiten.
 * De aftrek gebeurt conditioneel in de database, zodat twee snelle taps nooit
 * meer hints kunnen verbruiken dan de gebruiker werkelijk heeft.
 */
export async function consumeMysteryHint(userId: string, definition: MysteryDefinition, placements: Placements) {
  const hint = hintFor(definition, placements);
  const consumed = await prisma.user.updateMany({
    where: { id: userId, hintBalance: { gt: 0 } },
    data: { hintBalance: { decrement: 1 } },
  });
  if (consumed.count !== 1) return null;
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { hintBalance: true } });
  return { hint, hintBalance: current?.hintBalance ?? 0 };
}
