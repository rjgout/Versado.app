import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

// Persoonlijke sleep-volgorde voor de cursussenlijst (/courses),
// spelletjeslijst (/live) en zichtbaarheid op Vandaag — één generiek
// mechanisme voor die persoonlijke overzichten (zie
// UserListOrder in schema.prisma) i.p.v. twee losse ad-hoc kolommen. Geen
// opgeslagen rijen voor een lijst = val terug op de standaardvolgorde; dat
// bepaalt de aanroepende pagina zelf, deze route levert alleen de rauwe
// itemKey-volgorde. Daarnaast welke items de gebruiker uit het eigen
// overzicht verborg (`hidden`): verbergen is een
// persoonlijke weergavekeuze en geeft of ontneemt nooit toegang, dat blijft
// bij de spelinstellingen en de inhoud.

const listKeySchema = z.enum(["courses", "games", "today-continue"]);

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

const putSchema = z.object({
  listKey: listKeySchema,
  // Zichtbare items in hun volgorde; leeg mag (alles verborgen). Bij een
  // losse verbergactie mag dit wegblijven: de bestaande volgorde blijft dan
  // exact staan.
  itemKeys: z.array(z.string().max(100)).max(200).optional(),
  // Verborgen items. Zonder dit veld blijven de eerder verborgen items
  // verborgen (behalve wat nu in itemKeys staat): alleen herordenen raakt
  // de zichtbaarheid dan niet.
  hiddenKeys: z.array(z.string().max(100)).max(200).optional(),
  // Een kaart verbergen zonder eerst de bestaande persoonlijke lijst op te
  // halen. Nodig voor Vandaag, waar de server de volgorde bepaalt.
  hideKeys: z.array(z.string().max(100)).max(200).optional(),
}).refine((value) => value.itemKeys !== undefined || value.hiddenKeys !== undefined || value.hideKeys !== undefined);

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const { listKey } = parsed.data;
  const existing = await prisma.userListOrder.findMany({ where: { userId: user.id, listKey }, select: { itemKey: true, hidden: true }, orderBy: { order: "asc" } });
  const itemKeys = [...new Set(parsed.data.itemKeys ?? existing.filter((row) => !row.hidden).map((row) => row.itemKey))];
  const visible = new Set(itemKeys);
  const previouslyHidden = parsed.data.hiddenKeys
    ? []
    : existing.filter((row) => row.hidden).map((row) => row.itemKey);
  const hiddenKeys = [...new Set([...(parsed.data.hiddenKeys ?? previouslyHidden), ...(parsed.data.hideKeys ?? [])])].filter((key) => !visible.has(key));
  await prisma.$transaction([
    prisma.userListOrder.deleteMany({ where: { userId: user.id, listKey } }),
    prisma.userListOrder.createMany({
      data: [
        ...itemKeys.map((itemKey, order) => ({ userId: user.id, listKey, itemKey, order })),
        ...hiddenKeys.map((itemKey, i) => ({ userId: user.id, listKey, itemKey, order: itemKeys.length + i, hidden: true })),
      ],
    }),
  ]);

  return NextResponse.json({ ok: true });
}
