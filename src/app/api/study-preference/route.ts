import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
import { personalStudyModeRequestSchema } from "@/lib/studyContent/personalStudyMode";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, private", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

/** Eigen, idempotente voorkeur: dezelfde keuze nogmaals opslaan verandert niets en meldt niets aan andere apparaten. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  const t = getT(user?.uiLanguage);
  if (!user) return respond({ error: t("apiErrors.notLoggedIn") }, 401);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return respond({ error: t("apiErrors.forbidden") }, 403);
  const text = await req.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text.length <= 256 ? JSON.parse(text) : null;
  } catch {
    /* Ongeldige JSON valt onder invalidInput. */
  }
  const parsed = personalStudyModeRequestSchema.safeParse(json);
  if (!parsed.success) return respond({ error: t("apiErrors.invalidInput") }, 400);
  try {
    const changed = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ personalStudyMode: null }, { personalStudyMode: { not: parsed.data.mode } }] },
      data: { personalStudyMode: parsed.data.mode },
    });
    if (changed.count) emitToUser(user.id, DATA_EVENT_SOCKET_NAME, { event: "studyContextChanged" });
    return respond({ mode: parsed.data.mode, changed: changed.count > 0 });
  } catch {
    return respond({ error: t("apiErrors.notSaved") }, 503);
  }
}
