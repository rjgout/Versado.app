import { NextRequest, NextResponse } from "next/server";
import { listKeySchema, listPreferenceSchema, saveListPreferences } from "@/lib/listPreferences.server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

// Persoonlijke kaartvolgorde voor de cursussenlijst (/courses),
// spelletjeslijst (/live) en zichtbaarheid op Vandaag — één generiek
// mechanisme voor die persoonlijke overzichten (zie
// UserListOrder in schema.prisma) i.p.v. twee losse ad-hoc kolommen. Geen
// opgeslagen rijen voor een lijst = val terug op de standaardvolgorde; dat
// bepaalt de aanroepende pagina zelf, deze route levert alleen de rauwe
// itemKey-volgorde. Daarnaast welke items de gebruiker uit het eigen
// overzicht verborg (`hidden`): verbergen is een
// persoonlijke weergavekeuze en geeft of ontneemt nooit toegang, dat blijft
// bij de spelinstellingen en de inhoud.



export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const parsed = listKeySchema.safeParse(req.nextUrl.searchParams.get("listKey"));
  if (!parsed.success) return await apiError("apiErrors.invalidListKey", 400);

  const rows = await prisma.userListOrder.findMany({
    where: { userId: user.id, listKey: parsed.data },
    orderBy: { order: "asc" },
    select: { itemKey: true, hidden: true },
  });
  return NextResponse.json({
    order: rows.filter((r) => !r.hidden).map((r) => r.itemKey),
    hidden: rows.filter((r) => r.hidden).map((r) => r.itemKey),
  });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = listPreferenceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  await saveListPreferences({ userId: user.id }, parsed.data);
  return NextResponse.json({ ok: true });
}
