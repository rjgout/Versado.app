import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { findVersesContainingWord } from "@/lib/dictionary";
import { getContentContext } from "@/lib/contentCollections";
import { getContentAvailability } from "@/lib/contentAccess";
import { apiError } from "@/lib/apiError";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ word: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { word } = await params;
  const { active } = await getContentContext(user.id);
  if (!(await getContentAvailability(user, active.id, user.isAdmin ? "admin-preview" : "read"))) return await apiError("apiErrors.itemNotFound", 404);
  const verses = await findVersesContainingWord(decodeURIComponent(word), active.id);
  return NextResponse.json({ verses });
}
