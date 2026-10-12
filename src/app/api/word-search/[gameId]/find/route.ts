import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { findWordSearchWord } from "@/lib/wordSearch/game";

const position = z.object({ row: z.number().int().min(0).max(20), col: z.number().int().min(0).max(20) });
const schema = z.object({ start: position, end: position });

export async function POST(req: NextRequest, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const result = await findWordSearchWord(user.id, (await params).gameId, parsed.data.start, parsed.data.end);
  if (!result) return await apiError("apiErrors.itemNotFound", 404);
  return NextResponse.json(result);
}
