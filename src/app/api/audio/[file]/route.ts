import path from "node:path";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { audioDir, isAudioFileName, mirrorFileName } from "@/lib/audioMirror";
import { readingAccessWhere } from "@/lib/contentAccess";
import { prisma } from "@/lib/db";
import { audioRoot } from "@/lib/audio/storage";
import { streamAudio } from "@/lib/audio/stream";

async function serve(req: NextRequest, file: string, withBody: boolean) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const dir = audioDir();
  if (!dir || !isAudioFileName(file)) return await apiError("apiErrors.itemNotFound", 404);
  const chapters = await prisma.chapter.findMany({ where: { audioUrl: { endsWith: file }, book: { contentCollection: readingAccessWhere(user) } }, select: { audioUrl: true } });
  if (!chapters.some((c) => c.audioUrl && mirrorFileName(c.audioUrl) === file)) return await apiError("apiErrors.itemNotFound", 404);
  try {
    await audioRoot();
    return await streamAudio(path.join(dir, file), req.headers.get("range"), withBody);
  } catch { return await apiError("apiErrors.itemNotFound", 404); }
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) { return serve(req, (await params).file, true); }
export async function HEAD(req: NextRequest, { params }: { params: Promise<{ file: string }> }) { return serve(req, (await params).file, false); }
