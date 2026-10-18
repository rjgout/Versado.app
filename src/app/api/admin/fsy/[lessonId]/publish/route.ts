import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { publishFsyLesson } from "@/lib/fsyContent";
import { apiError } from "@/lib/apiError";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return await apiError("apiErrors.forbidden", 403);
  const { lessonId } = await params;
  const lesson = await prisma.fsyLesson.findUnique({ where: { id: lessonId }, select: { id: true, studyLessonEditionId: true } });
  if (!lesson) return await apiError("apiErrors.fsyLessonNotFound", 404);

  if (lesson.studyLessonEditionId) return NextResponse.json({ error: "FSY_STUDY_WRITER_ACTIVE" }, { status: 409 });
  try { await publishFsyLesson(prisma, lessonId); } catch (error) {
    if (error instanceof Error && error.message === "FSY_STUDY_WRITER_ACTIVE") return NextResponse.json({ error: "FSY_STUDY_WRITER_ACTIVE" }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
