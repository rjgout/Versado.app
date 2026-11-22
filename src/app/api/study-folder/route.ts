import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { annotationKind } from "@/lib/annotations/contract";
import { annotationResponse as response } from "@/lib/annotations/http";
import {
  getStudyFolderItem, listStudyFolder, listStudyFolderSources, StudyFolderError,
} from "@/lib/annotations/studyFolder";
import { studyFolderQuery as query } from "@/lib/annotations/studyFolderQuery";
export const runtime = "nodejs";

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
    // Een kleur hoort alleen bij markeringen; een ander type met kleur is een ongeldige combinatie.
    if (data.color && data.type && data.type !== "highlight") return response({ error: t("apiErrors.invalidInput") }, 400);
    return response(await listStudyFolder(user, data));
  } catch (error) {
    if (error instanceof StudyFolderError)
      return response({ code: error.code, error: t(error.code === "INVALID" ? "apiErrors.invalidInput" : "apiErrors.annotationNotFound") }, error.code === "INVALID" ? 400 : 404);
    return response({ error: t("apiErrors.notSaved") }, 503);
  }
}
