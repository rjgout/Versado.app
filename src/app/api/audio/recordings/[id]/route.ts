import path from "node:path";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { accessibleRecording } from "@/lib/audio/library";
import { audioRoot, safeDirectory, verifyObject } from "@/lib/audio/storage";
import { streamAudio } from "@/lib/audio/stream";
async function serve(req: NextRequest, id: string, withBody: boolean) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) return await apiError("apiErrors.itemNotFound", 404);
  const recording = await accessibleRecording(user, id, undefined, req.nextUrl.searchParams.get("preview") === "1");
  if (!recording) return await apiError("apiErrors.itemNotFound", 404);
  try {
    await verifyObject(recording.sha256, recording.byteSize);
    const folder = await safeDirectory(await audioRoot(), "objects");
    return await streamAudio(path.join(folder, recording.sha256 + ".mp3"), req.headers.get("range"), withBody);
  } catch { return await apiError("apiErrors.itemNotFound", 404); }
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return serve(req, (await params).id, true); }
export async function HEAD(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return serve(req, (await params).id, false); }
