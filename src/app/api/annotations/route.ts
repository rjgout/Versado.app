import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { annotationKind } from "@/lib/annotations/contract";
import { getAnnotation, listAnnotations, mutateAnnotation, AnnotationError } from "@/lib/annotations/service";
import { annotationJson, annotationResponse as response } from "@/lib/annotations/http";
import { failureLockSeconds, registerFailure } from "@/lib/rateLimit";
export const runtime = "nodejs";
const id = z.string().min(1).max(128);
const query = z.union([
  z.object({ kind: annotationKind, id }).strict(),
  z.object({ verseId: id }).strict(),
  z.object({ lessonEditionId: id }).strict(),
]);
async function handle(req: NextRequest, method: "GET" | "PUT" | "DELETE") {
  const user = await getCurrentUser(), t = getT(user?.uiLanguage);
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  if (method !== "GET" && !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return response({ error: t("apiErrors.forbidden") }, 403);
  try {
    if (method === "GET") {
      if ([...req.nextUrl.searchParams.keys()].length !== new Set(req.nextUrl.searchParams.keys()).size) return response({ error: t("apiErrors.invalidInput") }, 400);
      const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
      if (!parsed.success) return response({ error: t("apiErrors.invalidInput") }, 400);
      return response("id" in parsed.data ? await getAnnotation(user, parsed.data.kind, parsed.data.id) : await listAnnotations(user, parsed.data));
    }
    const key = `annotations:${user.id}`;
    if (failureLockSeconds(key, 120)) return response({ error: t("apiErrors.notSaved") }, 429);
    return response(await mutateAnnotation(user, await annotationJson(req).catch(() => null), method === "DELETE"));
  } catch (error) {
    if (method !== "GET" && error instanceof AnnotationError) registerFailure(`annotations:${user.id}`, 60_000);
    if (error instanceof AnnotationError) return response({ code: error.code, error: t(error.code === "INVALID" ? "apiErrors.invalidInput" : error.code === "CONFLICT" ? "apiErrors.notSaved" : "apiErrors.collectionUnavailable"), ...(error.state ? { state: error.state } : {}) }, error.code === "INVALID" ? 400 : error.code === "CONFLICT" ? 409 : 404);
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}
export const GET = (req: NextRequest) => handle(req, "GET");
export const PUT = (req: NextRequest) => handle(req, "PUT");
export const DELETE = (req: NextRequest) => handle(req, "DELETE");
