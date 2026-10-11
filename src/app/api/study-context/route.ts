import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed as mutationOriginAllowed } from "@/lib/content-inventory/origin";
import { getStudyContext, getStudyContexts, setStudyContext, StudyContextError } from "@/lib/studyContext";
import { studyContextActionSchema, studyWorkKeySchema } from "@/lib/studyContextContract";

const querySchema = z.object({ workKey: studyWorkKeySchema.optional() }).strict();
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function handle(req: NextRequest, mutate: boolean) {
  const user = await getCurrentUser();
  const t = getT(user?.uiLanguage ?? "nl");
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  if (mutate && !mutationOriginAllowed(req.headers, req.url, process.env.APP_URL)) {
    return response({ error: t("apiErrors.forbidden") }, 403);
  }
  try {
    if (!mutate) {
      const params = req.nextUrl.searchParams;
      const query = querySchema.safeParse(Object.fromEntries(params));
      if (!query.success || [...params.keys()].length !== new Set(params.keys()).size) {
        return response({ error: t("apiErrors.invalidInput") }, 400);
      }
      return response(query.data.workKey
        ? { context: await getStudyContext(user, query.data.workKey) }
        : { contexts: await getStudyContexts(user) });
    }
    const parsed = studyContextActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return response({ error: t("apiErrors.invalidInput") }, 400);
    return response(await setStudyContext(user, parsed.data));
  } catch (error) {
    if (error instanceof StudyContextError) {
      if (error.code === "CONFLICT") return response({ code: error.code, error: t("apiErrors.notSaved"), context: error.context }, 409);
      return response({ code: error.code, error: t(error.code === "INVALID_ACTION" ? "apiErrors.invalidInput" : "apiErrors.collectionUnavailable") }, error.code === "INVALID_ACTION" ? 400 : 404);
    }
    // Geen persoonlijke context, databasefouten of verbindingsgegevens in logs/responses.
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}

export const GET = (req: NextRequest) => handle(req, false);
export const PUT = (req: NextRequest) => handle(req, true);
