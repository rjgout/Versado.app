import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Welke oefening mag een gebruiker via de losse check- en hintroutes zien? Normaal alleen goedgekeurde oefeningen met leestoegang. Een oefening
 * die een contentimport buiten gebruik stelde (status niet APPROVED) blijft bereikbaar voor wie haar al in een eigen, nog open oefenset heeft:
 * anders zou de tussentijdse feedback "fout" tonen terwijl het inleveren (dat de set respecteert) haar wel goed rekent. Zie docs/CONTENTBEHEER.md.
 */
export async function exerciseAccessWhere(userId: string, exerciseId: string, base: Prisma.ExerciseWhereInput): Promise<Prisma.ExerciseWhereInput> {
  const inOpenSet = await prisma.exerciseSession.findFirst({
    where: { userId, submittedAt: null, exerciseIds: { contains: `"${exerciseId}"` } },
    select: { id: true },
  });
  return inOpenSet ? { id: exerciseId, ...base } : { id: exerciseId, ...base, status: "APPROVED" };
}
