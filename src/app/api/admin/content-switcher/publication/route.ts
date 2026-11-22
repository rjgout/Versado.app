import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { boundedJson } from "@/lib/requestBody";
import { notifyContentAvailabilityChanged } from "@/lib/realtime";
import { ScripturePublicationError, isScripturePublicationBusy, publishScriptureCollections, scripturePublicationState } from "@/lib/scripturePublication";

const headers = { "Cache-Control": "no-store, private", Vary: "Cookie" };
function failure(error: unknown) {
  if (error instanceof ScripturePublicationError) {
    const status = { FORBIDDEN: 403, INVALID: 400, BUSY: 409, CONFLICT: 409, INCOMPLETE: 422 }[error.code];
    return NextResponse.json({ error: error.code }, { status, headers });
  }
  // Geen SQL, tekst of identificerende metadata terugsturen. Lock- en transactiefouten sluiten veilig af.
  if (isScripturePublicationBusy(error)) return NextResponse.json({ error: "BUSY" }, { status: 409, headers });
  return NextResponse.json({ error: "FAILED" }, { status: 500, headers });
}
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
  if (!user.isAdmin) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
  try { return NextResponse.json(await scripturePublicationState(user), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
  if (!user.isAdmin || !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
  try {
    const result = await publishScriptureCollections(user, await boundedJson(req));
    if (result.changed) notifyContentAvailabilityChanged();
    return NextResponse.json(result, { headers });
  } catch (error) { return failure(error); }
}
