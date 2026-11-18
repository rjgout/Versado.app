import { z } from "zod";

/** Alleen hervatcoördinaten in ContentProgress. readVerse/readStatus blijven
 * uitsluitend eigendom van de bestaande expliciete lees-/lesacties. */
export const savedReaderPosition = z.object({
  verse: z.number().int().min(1).max(500), version: z.number().int().positive(),
  actionId: z.uuid(), expectedVersion: z.number().int().nonnegative(),
  selectionVersion: z.number().int().nonnegative(),
}).strict();
export type SavedReaderPosition = z.infer<typeof savedReaderPosition>;
export function readerPositionKey(value: {activeCollectionId:string;sourceLanguage:string;courseId:string;kind:string;targetId:string;chapterId:string}) {
  // Een JSON-tuple is botsingsvrij, ook voor geldige IDs met '-' of '_'.
  return JSON.stringify([value.activeCollectionId,value.sourceLanguage,value.courseId,value.kind,value.targetId,value.chapterId]);
}
export function readerPositions(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? {...value} : {};
}
export function readReaderPosition(value: unknown, key: string) {
  const parsed = savedReaderPosition.safeParse(readerPositions(value)[key]);
  return parsed.success ? parsed.data : null;
}
/** CAS, geen tijdstempel van de client en geen 'hoogste vers' (teruglezen mag).
 * Alleen dezelfde laatst gecommitte actie is een idempotente herhaling. */
export function claimReaderPosition(current: SavedReaderPosition | null, input: Omit<SavedReaderPosition,"version">): SavedReaderPosition | null {
  if (current?.actionId === input.actionId)
    return current.verse === input.verse && current.expectedVersion === input.expectedVersion && current.selectionVersion === input.selectionVersion ? current : null;
  if ((current?.version ?? 0) !== input.expectedVersion) return null;
  return {...input,version:input.expectedVersion+1};
}
