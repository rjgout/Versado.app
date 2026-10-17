import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { annotationKind } from "@/lib/annotations/contract";
import { annotationResponse as response } from "@/lib/annotations/http";
import {
  getStudyFolderItem, listStudyFolder, listStudyFolderSources, StudyFolderError,
  STUDY_FOLDER_MAX_CURSOR, STUDY_FOLDER_MAX_LIMIT, STUDY_FOLDER_MAX_QUERY,
} from "@/lib/annotations/studyFolder";
export const runtime = "nodejs";

const list = z.object({
  q: z.string().max(STUDY_FOLDER_MAX_QUERY * 4).optional(),
  type: annotationKind.optional(),
  source: z.string().min(1).max(128).optional(),
  cursor: z.string().min(1).max(STUDY_FOLDER_MAX_CURSOR).optional(),
  limit: z.coerce.number().int().min(1).max(STUDY_FOLDER_MAX_LIMIT).optional(),
}).strict();
const query = z.union([
  z.object({ view: z.literal("sources") }).strict(),
  z.object({ item: z.string().regex(/^(bookmark|highlight|note):[A-Za-z0-9_-]{1,128}$/) }).strict(),
  list,
]);

// Alleen eigen annotaties van de ingelogde gebruiker; nooit een door de client opgegeven gebruikers-id.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(), t = getT(user?.uiLanguage);
  if (!user) return response({ error: t("apiErrors.notLoggedIn") }, 401);
  const keys = [...req.nextUrl.searchParams.keys()];
  if (keys.length !== new Set(keys).size) return response({ error: t("apiErrors.invalidInput") }, 400);
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return response({ error: t("apiErrors.invalidInput") }, 400);
  try {
    const data = parsed.data;
    if ("view" in data) return response(await listStudyFolderSources(user));
    if ("item" in data) {
      const [kind, id] = data.item.split(":") as [z.infer<typeof annotationKind>, string];
      return response({ item: await getStudyFolderItem(user, kind, id) });
    }
    return response(await listStudyFolder(user, data));
  } catch (error) {
    if (error instanceof StudyFolderError)
      return response({ code: error.code, error: t(error.code === "INVALID" ? "apiErrors.invalidInput" : "apiErrors.annotationNotFound") }, error.code === "INVALID" ? 400 : 404);
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}
