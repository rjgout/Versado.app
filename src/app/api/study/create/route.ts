import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { isContentCollectionSelectable } from "@/lib/contentCollections";
import { supportsStudy } from "@/lib/study/units";
import { canStartStudy } from "@/lib/study/startAvailability";

const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);
const schema = z.object({ courseId: z.string().min(1).max(64) }).strict();

// Start Samen studeren voor een cursus: een lobby (LiveGame mode STUDY) met
// de maker als host. Uitnodigen, stappen kiezen en spelen gaan daarna via de
// socketserver (src/server/study.ts) op /live/<code>.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return apiError("apiErrors.forbidden", 403);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const course = await prisma.course.findUnique({
    where: { id: parsed.data.courseId },
    select: { id: true, type: true, enabled: true, podcastId: true, contentCollectionId: true },
  });
  if (!course || !course.enabled || !supportsStudy(course.type)) return await apiError("apiErrors.courseNotFound", 404);
  if (!(await isContentCollectionSelectable(course.contentCollectionId, user.isAdmin))) return await apiError("apiErrors.forbidden", 403);

  if (!(await canStartStudy(course.id))) return apiError("gameAvailability.unavailable", 403);

  let code = generateCode();
  for (let attempt = 0; attempt < 5 && (await prisma.liveGame.findUnique({ where: { code }, select: { id: true } })); attempt++) {
    code = generateCode();
  }
  await prisma.liveGame.create({
    data: {
      code,
      hostId: user.id,
      mode: "STUDY",
      status: "LOBBY",
      players: { create: { userId: user.id } },
      studySession: { create: { courseId: course.id } },
    },
  });
  return NextResponse.json({ code });
}
