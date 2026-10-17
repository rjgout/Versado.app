import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { resolveAnnotation, AnnotationError } from "@/lib/annotations/service";
import { annotationJson, annotationResponse as response } from "@/lib/annotations/http";
import { failureLockSeconds, registerFailure } from "@/lib/rateLimit";
export const runtime = "nodejs";

// Fase 4D: bevestig een nieuwe locatie voor een eigen studieannotatie. Alleen POST, alleen de ingelogde gebruiker;
// de server herberekent het voorstel en valideert de selector zelf (geen client-userId, geen vertrouwen in de client).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(), t = getT(user?.uiLanguage);
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return response({ error: t("apiErrors.forbidden") }, 403);
  const key = `annotations:${user.id}`;
  if (failureLockSeconds(key, 120)) return response({ error: t("apiErrors.notSaved") }, 429);
  try {
    return response(await resolveAnnotation(user, await annotationJson(req).catch(() => null)));
  } catch (error) {
    if (error instanceof AnnotationError) {
      registerFailure(key, 60_000);
      return response({ code: error.code, error: t(error.code === "INVALID" ? "apiErrors.invalidInput" : error.code === "CONFLICT" ? "apiErrors.notSaved" : "apiErrors.collectionUnavailable"), ...(error.state ? { state: error.state } : {}) }, error.code === "INVALID" ? 400 : error.code === "CONFLICT" ? 409 : 404);
    }
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}
