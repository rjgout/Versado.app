import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { failureLockSeconds, registerFailure } from "@/lib/rateLimit";
import { convertFsyLesson, reviewFsyConversion, rollbackFsyWriter, fsyConversionActionSchema, FsyConversionError } from "@/lib/studyContent/fsyConversion";
const headers = { "Cache-Control": "no-store, private" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const action = z.union([fsyConversionActionSchema, z.object({ confirm: z.literal("RESTORE_LEGACY_FSY_WRITER"), expectedVersion: z.number().int().positive() }).strict()]);
async function handle(req: NextRequest, params: Promise<{ lessonId: string }>, write: boolean) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "UNAUTHENTICATED" }, 401);
  if (!user.isAdmin) return reply({ error: "FORBIDDEN" }, 403);
  if (write && !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return reply({ error: "ORIGIN" }, 403);
  const key = `fsy-conversion:${user.id}`;
  if (failureLockSeconds(key, 20) > 0) return reply({ error: "RATE_LIMIT" }, 429);
  try {
    const { lessonId } = z.object({ lessonId: z.string().min(1).max(128) }).parse(await params);
    if (!write) return reply(await reviewFsyConversion(user, lessonId));
    const reader = req.body?.getReader();
    if (!reader) throw new Error("INVALID");
    const parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) throw new Error("INVALID");
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const body = action.parse(JSON.parse(Buffer.concat(parts).toString("utf8")));
    return reply(body.confirm === "CONVERT_EXISTING_FSY" ? await convertFsyLesson(user, lessonId, body) : await rollbackFsyWriter(user, lessonId, body.expectedVersion));
  } catch (error) {
    registerFailure(key, 60_000);
    return reply({ error: error instanceof FsyConversionError ? error.code : "INVALID" }, error instanceof FsyConversionError && error.code === "CONFLICT" ? 409 : 400);
  }
}
export const GET = (req: NextRequest, { params }: { params: Promise<{ lessonId: string }> }) => handle(req, params, false);
export const POST = (req: NextRequest, { params }: { params: Promise<{ lessonId: string }> }) => handle(req, params, true);
