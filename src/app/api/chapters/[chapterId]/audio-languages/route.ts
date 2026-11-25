import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { chapterAudioEditions } from "@/lib/audio/editions";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ chapterId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = z.object({ chapterId: z.string().min(1).max(200) }).safeParse(await params);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const result=await chapterAudioEditions(user,parsed.data.chapterId);
  return result ? NextResponse.json(result) : await apiError("apiErrors.itemNotFound",404);
}
