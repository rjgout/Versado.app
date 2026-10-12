import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getContentContext, getContentPickerContext, setActiveContentCollection, setContentLanguage, ContentSelectionConflict } from "@/lib/contentCollections";
import { applyContentSwitch } from "@/lib/contentSwitch";
import type { SwitchChange } from "@/lib/contentRouting";
import { LANGUAGES } from "@/lib/languages";
import { apiError } from "@/lib/apiError";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { contentSelectionSchema, safeContentLocation } from "@/lib/contentPickerContract";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json(req.nextUrl.searchParams.get("view") === "picker" ? await getContentPickerContext(user.id) : await getContentContext(user.id), { headers: { "Cache-Control": "no-store" } });
}

// Eén van beide: een uitgave kiezen (contentkiezer) of de taal van de content
// wisselen (taalknoppen in de kiezer, profiel). Met `location` (de huidige
// pagina) zoekt de server ook het equivalent van die pagina in de nieuwe
// content of taal; zonder blijft het een kale wissel, zoals het profiel die gebruikt.
const common = {
  location: z
    .object({
      pathname: z.string().startsWith("/").max(512),
      search: z.string().max(1024).default(""),
    }).strict()
    .optional(),
  /** Na de uitleg "niet beschikbaar" koos de gebruiker toch voor de wissel. */
  force: z.boolean().optional(),
  picker: z.boolean().optional(),
  expectedSelection: contentSelectionSchema.optional(),
};
const putSchema = z.union([
  z.object({ contentCollectionId: z.string().min(1).max(256), ...common }).strict(),
  z.object({ contentLanguage: z.enum(LANGUAGES.map((language) => language.code) as [string, ...string[]]), ...common }).strict(),
]).refine(value => !value.picker || Boolean(value.expectedSelection));

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return await apiError("apiErrors.forbidden", 403);

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.noCollectionOrLanguage", 400);
  const { location: requestedLocation, force, picker, expectedSelection } = parsed.data;
  const location = requestedLocation ? safeContentLocation(requestedLocation) : undefined;
  if (requestedLocation && !location) return await apiError("apiErrors.invalidInput", 400);
  const change: SwitchChange = "contentLanguage" in parsed.data ? { contentLanguage: parsed.data.contentLanguage } : { contentCollectionId: parsed.data.contentCollectionId };

  if (location || picker) {
    try {
      return NextResponse.json(await applyContentSwitch({ userId: user.id, isAdmin: user.isAdmin, change, location: location ?? undefined, force, picker, expectedSelection }), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof ContentSelectionConflict) return NextResponse.json({ code: "CONTENT_SELECTION_CONFLICT", selection: error.selection }, { status: 409, headers: { "Cache-Control": "no-store" } });
      return await apiError("contentLanguage" in change ? "apiErrors.languageUnavailableParen" : "apiErrors.collectionUnavailable", 404);
    }
  }

  if ("contentLanguage" in change) {
    try {
      await setContentLanguage(user.id, user.isAdmin, change.contentLanguage);
      return NextResponse.json(await getContentContext(user.id));
    } catch {
      return await apiError("apiErrors.languageUnavailableParen", 404);
    }
  }

  try {
    const active = await setActiveContentCollection(user.id, user.isAdmin, change.contentCollectionId);
    return NextResponse.json({ active });
  } catch {
    return await apiError("apiErrors.collectionUnavailable", 404);
  }
}
