import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { saveFeaturedAchievements } from "@/lib/featuredAchievements";

const selectionSchema = z.object({
  achievementIds: z.array(z.string().min(1).max(128)).max(5).refine((ids) => new Set(ids).size === ids.length),
});

/** De eigenaar mag alleen daadwerkelijk behaalde achievements uitlichten. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = selectionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  try {
    await saveFeaturedAchievements(user.id, parsed.data.achievementIds);
    return NextResponse.json({ achievementIds: parsed.data.achievementIds });
  } catch {
    return await apiError("apiErrors.invalidInput", 400);
  }
}
