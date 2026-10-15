import { NextRequest, NextResponse } from "next/server";
import { hymnsApiAllowed, jsonMaybeGzip } from "@/lib/hymns/apiAccess";
import { listIndex, readManifest } from "@/lib/hymns/library/server";

// Zoek- en lijstgegevens van de hele bibliotheek (compact; gzip ~6 KB). Het zoeken zelf gebeurt lokaal op het toestel.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await hymnsApiAllowed())) return new NextResponse(null, { status: 404 });
  const manifest = readManifest();
  return jsonMaybeGzip(req, `index:${manifest.dataVersion}`, { dataVersion: manifest.dataVersion, hymns: listIndex() }, { "Cache-Control": "private, max-age=300" });
}
