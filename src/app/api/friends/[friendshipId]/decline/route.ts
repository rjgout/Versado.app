import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { FriendRequestError, respondFriendRequest } from "@/lib/social/friendRequests";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ friendshipId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  try {
    const result = await respondFriendRequest({ userId: user.id }, (await params).friendshipId, "decline", true);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (!(error instanceof FriendRequestError)) throw error;
    return await apiError("apiErrors.requestNotFound", error.status);
  }
}
