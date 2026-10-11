import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { failureLockSeconds, registerFailure } from "@/lib/rateLimit";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { runContentInventory } from "@/lib/content-inventory/server";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

export async function POST(req: NextRequest) {
  let user;
  try { user = await getCurrentUser(); }
  catch { return NextResponse.json({ error: getT(null)("adminInventory.failed") }, { status: 503, headers }); }
  const t = getT(user?.uiLanguage);
  const error = (message: string, status: number, extra = {}) => NextResponse.json({ error: message }, { status, headers: { ...headers, ...extra } });
  if (!user) return error(t("apiErrors.notLoggedIn"), 401);
  if (!user.isAdmin) return error(t("apiErrors.forbidden"), 403);

  // De bestaande sessiecookie is SameSite=Lax. Deze gevoelige beheeractie
  // controleert bovendien expliciet Origin; geen ontbrekende/null herkomst.
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return error(t("apiErrors.forbidden"), 403);

  const key = `content-inventory:${user.id}`;
  const wait = failureLockSeconds(key, 1);
  if (wait) return error(t("adminInventory.rateLimited"), 429, { "Retry-After": String(wait) });
  // Eén poging per minuut per beheerder, ook bij fouten/parallelle verzoeken.
  registerFailure(key, 60000);
  try {
    return NextResponse.json(await runContentInventory(), { headers });
  } catch {
    // Geen ruwe driverfout naar de response en geen extra rapport-/errorlogging.
    return error(t("adminInventory.failed"), 503);
  }
}

export function GET() { return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { ...headers, Allow: "POST" } }); }
