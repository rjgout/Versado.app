import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { getStepProgressForEdition, recordStepProgress, StepProgressError } from "@/lib/studyContent/stepProgress";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    lessonEditionId: z.string().min(1).max(128),
    revisionId: z.string().min(1).max(128),
    stepIndex: z.number().int().min(1).max(7),
    stepFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    action: z.enum(["OPEN", "COMPLETE"]),
  })
  .strict();

const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const t = getT(user?.uiLanguage);
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  const id = z.string().min(1).max(128).safeParse(req.nextUrl.searchParams.get("lessonEditionId"));
  if (!id.success) return response({ error: t("apiErrors.invalidInput") }, 400);
  const result = await getStepProgressForEdition(user, id.data);
  if (!result) return response({ error: t("apiErrors.collectionUnavailable") }, 404);
  return response(result);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const t = getT(user?.uiLanguage);
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  if (req.headers.get("X-Reading-Session") !== (await navigationSessionKey())) return response({ error: t("apiErrors.forbidden") }, 403);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return response({ error: t("apiErrors.forbidden") }, 403);
  const text = await req.text().catch(() => "");
  if (text.length > 1024) return response({ error: t("apiErrors.invalidInput") }, 400);
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* Ongeldige JSON valt hieronder onder invalidInput. */
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return response({ error: t("apiErrors.invalidInput") }, 400);
  try {
    return response(await recordStepProgress(user, parsed.data));
  } catch (error) {
    if (error instanceof StepProgressError) {
      if (error.code === "REVISION_CHANGED") return response({ code: error.code, state: error.state, error: t("apiErrors.notSaved") }, 409);
      return response({ code: error.code, error: t(error.code === "INVALID" ? "apiErrors.invalidInput" : "apiErrors.collectionUnavailable") }, error.code === "INVALID" ? 400 : 404);
    }
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}
