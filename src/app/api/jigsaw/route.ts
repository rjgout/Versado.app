import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { getContentContext } from "@/lib/contentCollections";
import { getT } from "@/lib/i18n";
import { apiError } from "@/lib/apiError";
import { answerJigsaw, jigsawImages, jigsawLevelSchema, placeJigsawPiece, resumeJigsaw, startJigsaw } from "@/lib/jigsawGame";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), imageIndex: z.number().int().min(0).max(jigsawImages.length - 1), pieces: jigsawLevelSchema }),
  z.object({ action: z.literal("resume"), token: z.string().min(1).max(4096) }),
  z.object({ action: z.literal("answer"), token: z.string().min(1).max(4096), choice: z.number().int().min(0).max(2) }),
  z.object({ action: z.literal("place"), token: z.string().min(1).max(4096), piece: z.number().int().min(0).max(47), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const t = getT(user.uiLanguage);
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  if ((!settings.jigsawEnabled && !user.isAdmin) || !context.gameKeys.includes("jigsaw")) {
    return NextResponse.json({ error: t("jigsaw.unavailable") }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: t("apiErrors.invalidInput") }, { status: 400 });
  const input = parsed.data;
  if (input.action === "start") return NextResponse.json(await startJigsaw(user.id, input.imageIndex, input.pieces));
  if (input.action === "resume") {
    const state = await resumeJigsaw(user.id, input.token, user.uiLanguage);
    return state ? NextResponse.json(state) : NextResponse.json({ error: t("jigsaw.expired") }, { status: 400 });
  }
  if (input.action === "answer") {
    const outcome = await answerJigsaw(user.id, input.token, input.choice);
    if (outcome.status === "ok") return NextResponse.json(outcome.result);
    if (outcome.status === "already-answered") return NextResponse.json({ error: t("jigsaw.alreadyAnswered") }, { status: 409 });
    if (outcome.status === "incomplete") return NextResponse.json({ error: t("jigsaw.notComplete") }, { status: 400 });
    return NextResponse.json({ error: t("jigsaw.expired") }, { status: 400 });
  }
  const result = await placeJigsawPiece(user.id, input.token, input.piece, input.x, input.y, user.uiLanguage);
  if (!result) return NextResponse.json({ error: t("jigsaw.expired") }, { status: 400 });
  return NextResponse.json(result);
}
