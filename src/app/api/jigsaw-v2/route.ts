import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getContentContext } from "@/lib/contentCollections";
import { getGameSettings } from "@/lib/gameSettings";
import { apiError } from "@/lib/apiError";
import { getT } from "@/lib/i18n";
import { jigsawCatalog } from "@/lib/jigsawGame";
import { answerSoloPuzzle, applySoloAction, countSchema, difficultySchema, resumeSoloPuzzle, startSoloPuzzle } from "@/lib/puzzle/solo";

const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), groupId: z.string().min(1).max(64), x: z.number().finite().min(-100).max(100), y: z.number().finite().min(-100).max(100) }),
  z.object({ kind: z.literal("rotate"), groupId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("connect"), a: z.number().int().min(0).max(95), b: z.number().int().min(0).max(95) }),
]);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), imageIndex: z.number().int().min(0).max(jigsawCatalog.length - 1).optional(), imageId: z.string().refine((id) => jigsawCatalog.some((item) => item.url === id)).optional(), pieceCount: countSchema, difficulty: difficultySchema }).refine((input) => (input.imageId !== undefined) !== (input.imageIndex !== undefined)),
  z.object({ action: z.literal("resume"), sessionId: z.string().cuid() }),
  z.object({ action: z.literal("act"), sessionId: z.string().cuid(), version: z.number().int().positive(), actionId: z.string().uuid(), operation: actionSchema }),
  z.object({ action: z.literal("answer"), sessionId: z.string().cuid(), choice: z.number().int().min(0).max(2) }),
]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(); if (!user) return apiError("apiErrors.notLoggedIn", 401);
  const t = getT(user.uiLanguage);
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  if ((!settings.jigsawEnabled && !user.isAdmin) || !context.gameKeys.includes("jigsaw")) return NextResponse.json({ error: t("jigsaw.unavailable") }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400 });
  const input = parsed.data;
  try {
    if (input.action === "start") return NextResponse.json(await startSoloPuzzle(user.id, input.imageId ?? input.imageIndex!, input.pieceCount, input.difficulty, user.uiLanguage));
    if (input.action === "resume") { const state = await resumeSoloPuzzle(user.id, input.sessionId, user.uiLanguage); return state ? NextResponse.json(state) : NextResponse.json({ error: t("jigsaw.expired") }, { status: 404 }); }
    if (input.action === "act") { const state = await applySoloAction(user.id, input.sessionId, input.version, input.actionId, input.operation, user.uiLanguage); return state ? NextResponse.json(state) : NextResponse.json({ error: t("jigsaw.changed") }, { status: 409 }); }
    const result = await answerSoloPuzzle(user.id, input.sessionId, input.choice); return result ? NextResponse.json(result) : NextResponse.json({ error: t("jigsaw.notComplete") }, { status: 400 });
  } catch (error) { console.error("Legpuzzel v2:", error); return NextResponse.json({ error: t("jigsaw.failed") }, { status: 500 }); }
}
