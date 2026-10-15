import { NextRequest, NextResponse } from "next/server";
import { hymnsApiAllowed } from "@/lib/hymns/apiAccess";
import { loadSheetData, readManifest } from "@/lib/hymns/library/server";

// Bladmuziek van één lofzang (notatie + validatiestatus per couplet). Alleen opgevraagd als de gebruiker Bladmuziek kiest.
// Zelfde toegangsregel als de rest van de API: wie geen toegang heeft krijgt 404.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  if (!(await hymnsApiAllowed())) return new NextResponse(null, { status: 404 });
  const { number } = await ctx.params;
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return new NextResponse(null, { status: 404 });
  const sheet = loadSheetData(n);
  if (!sheet) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ dataVersion: readManifest().dataVersion, sheet }, { headers: { "Cache-Control": "private, max-age=300" } });
}
