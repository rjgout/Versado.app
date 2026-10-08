import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getFriendProfile } from "@/lib/friendProfiles";

/** Alleen geaccepteerde vrienden krijgen een profielweergave; een 404 lekt
 * niet of de id bestaat, of er een verzoek loopt, of een vriendschap is verwijderd. */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const viewer = await getCurrentUser();
  if (!viewer) return await apiError("apiErrors.notLoggedIn", 401);
  const { userId } = await params;
  const profile = await getFriendProfile(viewer.id, userId);
  if (!profile) return await apiError("apiErrors.friendshipNotFound", 404);
  return NextResponse.json(profile, { headers: { "Cache-Control": "private, no-store" } });
}
