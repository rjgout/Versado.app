import { NextRequest, NextResponse } from "next/server";
import { hymnsApiAllowed } from "@/lib/hymns/apiAccess";
import { loadReadableHymn, readManifest } from "@/lib/hymns/library/server";

// Eén lofzang (tekst, koppeling en, indien gevalideerd, de compositie). Alleen opgevraagd als de gebruiker hem opent.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  if (!(await hymnsApiAllowed())) return new NextResponse(null, { status: 404 });
  const { number } = await ctx.params;
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return new NextResponse(null, { status: 404 });
  const hymn = loadReadableHymn(n);
  if (!hymn) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ dataVersion: readManifest().dataVersion, hymn }, { headers: { "Cache-Control": "private, max-age=300" } });
}
