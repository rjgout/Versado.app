import { z } from "zod";
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const nativeTodayHideSchema = z.object({ itemKey: z.string().min(1).max(100).regex(/^(?:course|kids|intro|podcast)-[A-Za-z0-9_-]+:\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/) }).strict();
export const nativeFriendResponseSchema = z.object({ friendshipId: id, action: z.enum(["accept", "decline"]) }).strict();
export const nativeTodayActionResultSchema = z.object({ version: z.literal(1), userId: id,
  outcome: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("hidden"), itemKey: nativeTodayHideSchema.shape.itemKey }).strict(),
    z.object({ kind: z.literal("friend-response"), friendshipId: id, status: z.enum(["accepted", "declined"]), changed: z.boolean() }).strict(),
  ]),
}).strict();
export type NativeTodayActionResult = z.infer<typeof nativeTodayActionResultSchema>;
