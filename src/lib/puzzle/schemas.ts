import { z } from "zod";
import { COOP_PIECE_COUNTS, MATCH_PIECE_COUNTS } from "@/lib/puzzle/types";

// Gedeelde invoerschema's voor HTTP-routes en socket-events van Samen en
// Tegen elkaar. Eén bron, zodat beide wegen dezelfde grenzen afdwingen.
export const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), groupId: z.string().min(1).max(64), x: z.number().finite().min(-200).max(200), y: z.number().finite().min(-200).max(200) }),
  z.object({ kind: z.literal("rotate"), groupId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("anchor"), groupId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("connect"), a: z.number().int().min(0).max(299), b: z.number().int().min(0).max(299) }),
]);
export const hintRequestSchema = z.object({
  hint: z.enum(["PREVIEW", "LOCATION", "CONNECTION", "FILTER"]),
  confirmPersonal: z.boolean().optional(),
  pieceId: z.number().int().min(0).max(299).optional(),
  filter: z.enum(["CORNERS", "EDGES", "MIDDLES"]).optional(),
}).refine((input) => input.hint === "PREVIEW" || (input.hint === "FILTER" ? input.filter !== undefined : input.pieceId !== undefined));
export const difficultySchema = z.enum(["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"]);
export const coopCountSchema = z.union(COOP_PIECE_COUNTS.map((count) => z.literal(count)) as unknown as [z.ZodLiteral<24>, z.ZodLiteral<48>, ...z.ZodLiteral<number>[]]);
export const matchCountSchema = z.union(MATCH_PIECE_COUNTS.map((count) => z.literal(count)) as unknown as [z.ZodLiteral<6>, z.ZodLiteral<12>, ...z.ZodLiteral<number>[]]);
export const idSchema = z.string().cuid();
export const friendIdsSchema = z.array(z.string().min(1).max(40)).max(3);
export const actionIdSchema = z.string().uuid();
export const commitSchema = z.object({
  sessionId: idSchema,
  actionId: actionIdSchema,
  baseVersion: z.number().int().nonnegative().optional(),
  lockToken: z.string().min(1).max(64).optional(),
  operation: operationSchema,
});
