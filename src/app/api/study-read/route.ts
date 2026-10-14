import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { markStudyLessonRead, StudyReadError } from "@/lib/studyContent/readStatus";

export const runtime = "nodejs";

const requestSchema = z.object({
  lessonEditionId: z.string().min(1).max(128),
  revisionId: z.string().min(1).max(128),
  actionId: z.uuid().transform((value) => value.toLowerCase()),
}).strict();

const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    },
  });

async function boundedJson(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader || Number(req.headers.get("content-length") ?? 0) > 1024)
    return null;
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > 1024) return null;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const t = getT(user?.uiLanguage);
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  if (req.headers.get("X-Reading-Session") !== await navigationSessionKey())
    return response({ error: t("apiErrors.forbidden") }, 403);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL))
    return response({ error: t("apiErrors.forbidden") }, 403);
  const parsed = requestSchema.safeParse(await boundedJson(req).catch(() => null));
  if (!parsed.success) return response({ error: t("apiErrors.invalidInput") }, 400);
  try {
    return response(await markStudyLessonRead(user, parsed.data));
  } catch (error) {
    if (error instanceof StudyReadError) {
      if (error.code === "REVISION_CHANGED")
        return response({ code: error.code, state: error.state, error: t("apiErrors.notSaved") }, 409);
      return response(
        { code: error.code, error: t(error.code === "INVALID" ? "apiErrors.invalidInput" : "apiErrors.collectionUnavailable") },
        error.code === "INVALID" ? 400 : 404,
      );
    }
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}
