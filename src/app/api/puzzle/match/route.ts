import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jigsawCatalog } from "@/lib/jigsawGame";
import { answerMatch, applyMatchAction, beginMatchAttempt, cancelMatch, createMatch, getMatch, matchQuestion, respondToMatchInvite, resumeMatchPuzzle, revokeMatchInvite, startLiveMatch } from "@/lib/puzzle/match";
import { actionIdSchema, difficultySchema, friendIdsSchema, idSchema, matchCountSchema } from "@/lib/puzzle/schemas";
import { puzzleErrorResponse, puzzleRouteUser } from "@/lib/puzzle/routeGuard";

// Tegen elkaar. De eigen puzzel (act/resume/answer) gebruikt dezelfde vorm als Solo
// (/api/jigsaw-v2), zodat dezelfde werktafel en hintsheet worden hergebruikt.
const operation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), groupId: z.string().min(1).max(64), x: z.number().finite().min(-100).max(100), y: z.number().finite().min(-100).max(100) }),
  z.object({ kind: z.literal("rotate"), groupId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("anchor"), groupId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("hint"), hint: z.enum(["PREVIEW", "LOCATION", "CONNECTION", "FILTER"]), confirmPersonal: z.boolean().optional(), pieceId: z.number().int().min(0).max(95).optional(), filter: z.enum(["CORNERS", "EDGES", "MIDDLES"]).optional() }).refine((input) => input.hint === "PREVIEW" || (input.hint === "FILTER" ? input.filter !== undefined : input.pieceId !== undefined)),
  z.object({ kind: z.literal("connect"), a: z.number().int().min(0).max(95), b: z.number().int().min(0).max(95) }),
]);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), imageId: z.string().refine((id) => jigsawCatalog.some((item) => item.url === id)), pieceCount: matchCountSchema, difficulty: difficultySchema, friendIds: friendIdsSchema.min(1), kind: z.enum(["LIVE", "ASYNC"]) }),
  z.object({ action: z.literal("respond"), matchId: idSchema, accept: z.boolean() }),
  z.object({ action: z.literal("revoke"), matchId: idSchema, userId: z.string().min(1).max(40) }),
  z.object({ action: z.literal("start"), matchId: idSchema }),
  z.object({ action: z.literal("begin"), matchId: idSchema }),
  z.object({ action: z.literal("cancel"), matchId: idSchema }),
  z.object({ action: z.literal("state"), matchId: idSchema }),
  z.object({ action: z.literal("resume"), matchId: idSchema }),
  z.object({ action: z.literal("act"), matchId: idSchema, version: z.number().int().positive(), actionId: actionIdSchema, operation }),
  z.object({ action: z.literal("answer"), matchId: idSchema, choice: z.number().int().min(0).max(2) }),
]);

export async function POST(req: NextRequest) {
  const guard = await puzzleRouteUser(); if ("response" in guard) return guard.response;
  const { user, t } = guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400 });
  const input = parsed.data;
  try {
    switch (input.action) {
      case "create": return NextResponse.json({ matchId: await createMatch(user.id, input.imageId, input.pieceCount as 6, input.difficulty, input.friendIds, input.kind) });
      case "respond": await respondToMatchInvite(user.id, input.matchId, input.accept); return NextResponse.json({ ok: true });
      case "revoke": await revokeMatchInvite(user.id, input.matchId, input.userId); return NextResponse.json({ ok: true });
      case "start": await startLiveMatch(user.id, input.matchId); return NextResponse.json({ ok: true });
      case "begin": return NextResponse.json({ sessionId: await beginMatchAttempt(user.id, input.matchId) });
      case "cancel": await cancelMatch(user.id, input.matchId); return NextResponse.json({ ok: true });
      case "state": return NextResponse.json({ match: await getMatch(user.id, input.matchId), question: await matchQuestion(user.id, input.matchId, user.uiLanguage) });
      case "resume": return NextResponse.json(await resumeMatchPuzzle(user.id, input.matchId, user.uiLanguage));
      case "act": {
        const state = await applyMatchAction(user.id, input.matchId, input.version, input.actionId, input.operation, user.uiLanguage);
        return state ? NextResponse.json(state) : NextResponse.json({ error: t("jigsaw.changed") }, { status: 409 });
      }
      case "answer": return NextResponse.json(await answerMatch(user.id, input.matchId, input.choice));
    }
  } catch (error) {
    // De Solo-hintfouten hebben een eigen vorm (code EMPTY/CONFIRM) die de bestaande client verwacht.
    const hint = error as { code?: string; hintBalance?: number };
    if (error instanceof Error && (hint.code === "EMPTY" || hint.code === "CONFIRM")) {
      return NextResponse.json({ error: t(hint.code === "EMPTY" ? "jigsaw.hintEmpty" : "jigsaw.hintPersonalCost"), code: hint.code, hintBalance: hint.hintBalance }, { status: hint.code === "EMPTY" ? 402 : 409 });
    }
    return puzzleErrorResponse(error, t);
  }
}
