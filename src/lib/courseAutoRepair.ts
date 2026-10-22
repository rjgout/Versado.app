import type { PrismaClient } from "@/generated/prisma/client";
import { applyDuplicateRepair, planDuplicateRepair } from "./courseRepair";

// Automatisch herstel van dubbele leescursussen bij het opstarten van de app (zie docs/CURSUSIDENTITEIT.md). Het gebruikt precies de bestaande,
// transactionele herstelmodule (courseRepair.ts): alleen groepen met oordeel "merge" worden samengevoegd, elke dubbele cursus in een eigen transactie
// met hervalidatie en eindcontrole, voortgang wordt nooit overschreven met minder. Groepen met oordeel "blocked" worden niet aangeraakt en alleen gemeld.
// Deze module staat in de eager-importketen van server.ts: geen import van Next-API's, en een fout mag het opstarten nooit blokkeren.

export interface AutoRepairOutcome {
  status: "disabled" | "clean" | "done";
  merged: number;
  blocked: number;
}

type Logger = Pick<Console, "log" | "warn">;

/** Technische noodstop: COURSES_AUTO_REPAIR=off zet het automatische herstel uit (de handmatige scripts blijven werken). */
export function autoRepairEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.COURSES_AUTO_REPAIR ?? "").trim().toLowerCase() !== "off";
}

export async function healDuplicateReadingCourses(
  db: PrismaClient,
  options: { env?: Record<string, string | undefined>; logger?: Logger } = {}
): Promise<AutoRepairOutcome> {
  const logger = options.logger ?? console;
  if (!autoRepairEnabled(options.env)) {
    logger.log("Cursussen: automatisch herstel van dubbele leescursussen staat uit (COURSES_AUTO_REPAIR=off).");
    return { status: "disabled", merged: 0, blocked: 0 };
  }
  const plans = await planDuplicateRepair(db);
  if (plans.length === 0) return { status: "clean", merged: 0, blocked: 0 };
  const result = await applyDuplicateRepair(db, plans);
  // Alleen technische identificaties: cursus-id's, geen gebruikersgegevens.
  for (const merged of result.merged) {
    logger.log(`Cursussen: dubbele leescursus ${merged.duplicateId} samengevoegd met ${merged.canonicalId} ${JSON.stringify(merged.moved)}.`);
  }
  for (const group of result.blocked) {
    logger.warn(`Cursussen: dubbele leescursussen in ${group.group.contentCollectionId} (${group.group.type}) niet automatisch samengevoegd: ${group.notes.join(" ")}`);
  }
  return { status: "done", merged: result.merged.length, blocked: result.blocked.length };
}
