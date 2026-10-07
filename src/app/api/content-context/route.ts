import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getContentContext, setActiveContentCollection, setContentLanguage } from "@/lib/contentCollections";
import { applyContentSwitch } from "@/lib/contentSwitch";
import type { SwitchChange } from "@/lib/contentRouting";
import { LANGUAGES } from "@/lib/languages";
import { apiError } from "@/lib/apiError";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json(await getContentContext(user.id));
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
    })
    .optional(),
  /** Na de uitleg "niet beschikbaar" koos de gebruiker toch voor de wissel. */
  force: z.boolean().optional(),
};
const putSchema = z.union([
  z.object({ contentCollectionId: z.string().min(1), ...common }),
  z.object({ contentLanguage: z.enum(LANGUAGES.map((language) => language.code) as [string, ...string[]]), ...common }),
]);

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.noCollectionOrLanguage", 400);
  const { location, force } = parsed.data;
  const change: SwitchChange = "contentLanguage" in parsed.data ? { contentLanguage: parsed.data.contentLanguage } : { contentCollectionId: parsed.data.contentCollectionId };

  if (location) {
    try {
      return NextResponse.json(await applyContentSwitch({ userId: user.id, isAdmin: user.isAdmin, change, location, force }));
    } catch {
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
