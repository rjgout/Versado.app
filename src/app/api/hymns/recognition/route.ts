import { NextRequest, NextResponse } from "next/server";
import { hymnsApiAllowed, jsonMaybeGzip } from "@/lib/hymns/apiAccess";
import { loadRecognitionBundle, readManifest } from "@/lib/hymns/library/server";

// Alle composities waarmee herkend kan worden (gzip ~0,13 MB). Eén keer geladen (en lokaal bewaard) vóór de microfoon start:
// tijdens een dienst gaat er geen verzoek meer naar de server voor de herkenning.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await hymnsApiAllowed())) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  const version = readManifest().dataVersion;
  return jsonMaybeGzip(req, `recognition:${version}`, { dataVersion: version, ...loadRecognitionBundle() }, { "Cache-Control": "private, no-store" });
}
