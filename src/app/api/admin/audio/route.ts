import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { audioOverview, publishAudio } from "@/lib/audio/library";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);
  return NextResponse.json(await audioOverview(), { headers });
}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin || !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return await apiError("apiErrors.forbidden", 403);
  const reader = req.body?.getReader();
  if (!reader) return await apiError("apiErrors.invalidInput", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 4096) return await apiError("apiErrors.invalidInput", 400);
      chunks.push(value);
    }
    const input = z.object({ recordingId: z.string().min(1).max(200), expectedVersion: z.number().int().nonnegative().max(2147483646) }).strict().safeParse(JSON.parse(Buffer.concat(chunks).toString()));
    if (!input.success) return await apiError("apiErrors.invalidInput", 400);
    return NextResponse.json(await publishAudio(user, input.data.recordingId, input.data.expectedVersion), { headers });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return await apiError("apiErrors.forbidden", 403);
    return await apiError("apiErrors.invalidInput", error instanceof SyntaxError ? 400 : 409);
  }
  finally { await reader.cancel().catch(() => {}); }
}
