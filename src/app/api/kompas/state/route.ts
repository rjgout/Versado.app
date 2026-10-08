import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getKompasRows, isRecordInput, recordKompas } from "@/lib/kompas/store";

// De status van Versado Kompas voor de ingelogde gebruiker: wat er al getoond,
// bekeken, overgeslagen of afgerond is. Raakt nooit XP, reeksen of scores.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json({ rows: await getKompasRows(user.id), offersEnabled: user.kompasOffersEnabled });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const body: unknown = await req.json().catch(() => null);
  if (!isRecordInput(body)) return await apiError("apiErrors.invalidInput", 400);
  const row = await recordKompas(user.id, { topicId: body.topicId, scope: body.scope, kind: body.kind, status: body.status });
  return NextResponse.json({ row });
}
