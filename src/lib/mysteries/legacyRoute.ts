import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { MYSTERY_GAME } from "./game";
import { getMysteryProgress } from "./progress";

/** Eigen historische voortgang blijft leesbaar; oude unaudited mutaties niet. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({}, { status: 401 });
  const path = req.nextUrl.pathname.split("/");
  const definition = MYSTERY_GAME.puzzles.find(d => path.includes(d.routeId));
  if (!definition) return NextResponse.json({}, { status: 404 });
  return NextResponse.json(await getMysteryProgress(user.id, definition), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({}, { status: 401 });
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return NextResponse.json({}, { status: 403 });
  return NextResponse.json({ error: getT(user.uiLanguage)("mysteryPersistence.reload") }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
