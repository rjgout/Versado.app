import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { buildReport } from "@/lib/hymns/library/server";
import { hymnsApiAllowed } from "@/lib/hymns/apiAccess";

// Kwaliteitsoverzicht van de bibliotheek, alleen voor beheerders (gewone gebruikers: 404).
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hymnsApiAllowed())) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  const user = await getCurrentUser();
  if (!user?.isAdmin) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  return NextResponse.json(buildReport(), { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
