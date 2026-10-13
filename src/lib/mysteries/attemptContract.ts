import { z } from "zod";
import type { MysteryDefinition, Placements } from "./types";
import { characterCluesFor } from "./characterClues";
import { isHardConstraintValid } from "./logic";

const cell = z.object({ row: z.number().int().positive(), column: z.number().int().positive() }).strict();
export const mysteryBoardSchema = z.object({
  placements: z.record(z.string(), cell.nullable()),
  clueNotes: z.record(z.string(), z.boolean()),
}).strict();
const action = { actionId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() };
export const mysteryActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), variant: z.string().regex(/^00[1-6][abc]$/), actionId: action.actionId, restart: z.boolean().optional(), attemptId: z.string().min(1).max(100).optional(), expectedRevision: action.expectedRevision.optional() }).strict(),
  z.object({ action: z.literal("save"), attemptId: z.string().min(1).max(100), ...action, ...mysteryBoardSchema.shape }).strict(),
  z.object({ action: z.literal("hint"), attemptId: z.string().min(1).max(100), ...action }).strict(),
  z.object({ action: z.literal("complete"), attemptId: z.string().min(1).max(100), ...action }).strict(),
]);
export type MysteryAction = z.infer<typeof mysteryActionSchema>;
export function emptyClueNotes(definition: MysteryDefinition): Record<string, boolean> {
  return Object.fromEntries(definition.characters.flatMap(character => characterCluesFor(definition, character.id).map((_, index) => [`${character.id}-${index}`, false])));
}
export function validMysteryBoard(definition: MysteryDefinition, input: unknown): boolean {
  const parsed = mysteryBoardSchema.safeParse(input);
  if (!parsed.success) return false;
  const { placements, clueNotes } = parsed.data;
  const characters = definition.characters.map(character => character.id);
  const keys = Object.keys(emptyClueNotes(definition));
  return Object.keys(placements).every(key => characters.includes(key as typeof characters[number]))
    && Object.keys(clueNotes).every(key => keys.includes(key))
    && definition.characters.every(({ id }) => !placements[id] || isHardConstraintValid(definition, placements as Placements, id, placements[id]!));
}
export interface MysteryAttemptView {
  id: string;
  revision: number;
  status: "IN_PROGRESS" | "COMPLETED";
  available: boolean;
  placements: Placements;
  clueNotes: Record<string, boolean>;
  hintCount: number;
  hint: string | null;
  readerHref: string | null;
}
