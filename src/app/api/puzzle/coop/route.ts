import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jigsawCatalog } from "@/lib/jigsawGame";
import { acquireCoopLock, commitCoopAction, createCoopSession, getCoopState, inviteToCoop, leaveCoopSession, listCoopOverview, releaseCoopLocks, renewCoopLock, respondToCoopInvite, revokeCoopInvite, syncCoopState, spendCoopHint } from "@/lib/puzzle/coop";
import { actionIdSchema, commitSchema, coopCountSchema, difficultySchema, friendIdsSchema, hintRequestSchema, idSchema } from "@/lib/puzzle/schemas";
import { puzzleErrorResponse, puzzleRouteUser } from "@/lib/puzzle/routeGuard";

// Samen puzzelen: HTTP is de duurzame weg (aanmaken, uitnodigingen, herstel, hints,
// en een terugval voor commits); live synchronisatie loopt via Socket.IO (src/server/puzzle.ts)
// langs dezelfde servicefuncties.
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), imageId: z.string().refine((id) => jigsawCatalog.some((item) => item.url === id)), pieceCount: coopCountSchema, difficulty: difficultySchema, friendIds: friendIdsSchema }),
  z.object({ action: z.literal("invite"), sessionId: idSchema, friendIds: friendIdsSchema.min(1) }),
  z.object({ action: z.literal("respond"), inviteId: idSchema, accept: z.boolean() }),
  z.object({ action: z.literal("revoke"), inviteId: idSchema }),
  z.object({ action: z.literal("state"), sessionId: idSchema }),
  z.object({ action: z.literal("sync"), sessionId: idSchema, version: z.number().int().nonnegative() }),
  z.object({ action: z.literal("commit") }).merge(commitSchema),
  z.object({ action: z.literal("lock"), sessionId: idSchema, groupId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("renew"), sessionId: idSchema, groupId: z.string().min(1).max(64), token: z.string().min(1).max(64) }),
  z.object({ action: z.literal("release"), sessionId: idSchema, groupId: z.string().min(1).max(64).optional(), token: z.string().min(1).max(64).optional() }),
  z.object({ action: z.literal("hint"), sessionId: idSchema, actionId: actionIdSchema, request: hintRequestSchema }),
  z.object({ action: z.literal("leave"), sessionId: idSchema }),
  z.object({ action: z.literal("overview") }),
]);

export async function POST(req: NextRequest) {
  const guard = await puzzleRouteUser(req); if ("response" in guard) return guard.response;
  const { user, t } = guard;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400 });
  if (Object.keys(body).some(key => !(key in parsed.data))) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400 });
  const input = parsed.data;
  try {
    switch (input.action) {
      case "create": return NextResponse.json({ sessionId: await createCoopSession(user.id, input.imageId, input.pieceCount as 24, input.difficulty, input.friendIds) });
      case "invite": return NextResponse.json(await inviteToCoop(user.id, input.sessionId, input.friendIds));
      case "respond": return NextResponse.json({ sessionId: await respondToCoopInvite(user.id, input.inviteId, input.accept) });
      case "revoke": await revokeCoopInvite(user.id, input.inviteId); return NextResponse.json({ ok: true });
      case "state": return NextResponse.json(await getCoopState(user.id, input.sessionId));
      case "sync": return NextResponse.json(await syncCoopState(user.id, input.sessionId, input.version));
      case "commit": return NextResponse.json(await commitCoopAction(user.id, input.sessionId, input));
      case "lock": return NextResponse.json(await acquireCoopLock(user.id, input.sessionId, input.groupId));
      case "renew": return NextResponse.json(await renewCoopLock(user.id, input.sessionId, input.groupId, input.token));
      case "release": await releaseCoopLocks(user.id, input.sessionId, { groupId: input.groupId, token: input.token }); return NextResponse.json({ ok: true });
      case "hint": return NextResponse.json(await spendCoopHint(user.id, input.sessionId, input.actionId, input.request));
      case "leave": await leaveCoopSession(user.id, input.sessionId); return NextResponse.json({ ok: true });
      case "overview": return NextResponse.json(await listCoopOverview(user.id));
    }
  } catch (error) { return puzzleErrorResponse(error, t); }
}
