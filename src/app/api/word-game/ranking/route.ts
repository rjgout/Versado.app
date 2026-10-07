import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getWordGameRanking } from "@/lib/wordGame";
import { apiError } from "@/lib/apiError";

// Alleen het klassement van de woorddag, voor de live-verversing van een open
// klassement (zie docs/DATA-REFRESH.md): licht, en maakt nooit een potje aan.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json(await getWordGameRanking(user.id, user.timeZone));
}
