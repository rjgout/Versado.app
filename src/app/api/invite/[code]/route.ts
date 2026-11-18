import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { formatTag } from "@/lib/handle";
import { becomeFriendsViaInvite, findInviter, INVALID_INVITE_ERROR } from "@/lib/friendInvite";
import { apiError, apiErrorText } from "@/lib/apiError";
import { clientIp } from "@/lib/rateLimit";
import { socialBudget } from "@/lib/social/abuseBudgets";
import type { NextRequest } from "next/server";

// Bewust zonder inlog: de registratiepagina toont hiermee wie je uitnodigt.
// Alleen naam en avatar, nooit het e-mailadres.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  // Publiek endpoint: per client-IP begrensd tegen het opsommen van uitnodigingscodes.
  const limited = await socialBudget("inviteLookup", clientIp(req));
  if (limited) return limited;
  const { code } = await params;
  const inviter = await findInviter(code);
  if (!inviter) return await apiErrorText(INVALID_INVITE_ERROR, 404);
  return NextResponse.json({
    inviter: {
      id: inviter.id,
      handle: inviter.handle,
      tag: formatTag(inviter.handle, inviter.discriminator),
      avatarEmoji: inviter.avatarEmoji,
    },
  });
}

// Een bestaand account dat de link opent en op "Word vrienden" tikt.
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const limited = await socialBudget("inviteAccept", user.id);
  if (limited) return limited;

  const { code } = await params;
  const result = await becomeFriendsViaInvite(code, user.id, { isNewAccount: false });
  if (!result.ok) return await apiErrorText(result.error, 400);
  return NextResponse.json(result);
}
