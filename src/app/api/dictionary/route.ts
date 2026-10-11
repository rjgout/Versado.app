import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getDictionaryEntries } from "@/lib/dictionary";
import { getContentContext } from "@/lib/contentCollections";
import { getContentAvailability } from "@/lib/contentAccess";
import { apiError } from "@/lib/apiError";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  // Het woordenboek van de gekozen collectie (Boek van Mormon, Leer en Verbonden, ...).
  const { active } = await getContentContext(user.id);
  if (!(await getContentAvailability(user, active.id))) return await apiError("apiErrors.itemNotFound", 404);
  return NextResponse.json({ collectionName: active.name, entries: getDictionaryEntries(active.id) });
}
