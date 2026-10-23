import { optionsFingerprint, planExerciseSync } from "../src/lib/exerciseSync";

export interface SimpleSyncStats { kept: number; updated: number; created: number; deleted: number }

/**
 * Brengt de oefeningen van één aflevering/verhaal/les in overeenstemming met de gewenste set, zonder ongewijzigde oefeningen
 * aan te raken (zelfde regel als bij de hoofdstukoefeningen, zie src/lib/exerciseSync.ts). De opslag-specifieke stappen
 * komen van de importer, omdat de drie soorten (podcast, kinderen, introductie) eigen tabellen hebben.
 * Deze soorten kennen geen "buiten gebruik"-status: een inhoudelijk gewijzigde of verdwenen oefening wordt verwijderd; de
 * voortgang van de gebruiker hangt aan de aflevering, het verhaal of de les en blijft dus bestaan.
 */
export async function reconcileSimpleExercises<Row extends { order: number }, Opt extends { label: string; isCorrect?: boolean | null }>(args: {
  existing: { id: string; order: number; signature: string; options: { label: string; isCorrect: boolean }[] }[];
  desired: { row: Row; signature: string; options: Opt[] }[];
  /** Dezelfde vraag met andere afleiders: de opties van die oefening vervangen (het id blijft). */
  replaceOptions: (exerciseId: string, options: Opt[]) => Promise<unknown>;
  setOrder: (id: string, order: number) => Promise<unknown>;
  create: (rows: Row[], options: Opt[]) => Promise<unknown>;
  remove: (ids: string[]) => Promise<unknown>;
}): Promise<SimpleSyncStats> {
  const plan = planExerciseSync(args.existing, args.desired.map((item) => item.signature));
  const stats: SimpleSyncStats = { kept: 0, updated: 0, created: 0, deleted: plan.unmatched.length };
  const newRows: Row[] = [];
  const newOptions: Opt[] = [];
  for (let i = 0; i < args.desired.length; i++) {
    const keep = plan.keep[i];
    if (!keep) {
      newRows.push(args.desired[i].row);
      newOptions.push(...args.desired[i].options);
      continue;
    }
    stats.kept++;
    let touched = false;
    if (keep.order !== args.desired[i].row.order) {
      await args.setOrder(keep.id, args.desired[i].row.order);
      touched = true;
    }
    if (keep.options && optionsFingerprint(keep.options) !== optionsFingerprint(args.desired[i].options.map((o) => ({ label: o.label, isCorrect: o.isCorrect ?? false })))) {
      await args.replaceOptions(keep.id, args.desired[i].options);
      touched = true;
    }
    if (touched) stats.updated++;
  }
  stats.created = newRows.length;
  if (plan.unmatched.length > 0) await args.remove(plan.unmatched.map((row) => row.id));
  if (newRows.length > 0) await args.create(newRows, newOptions);
  return stats;
}
