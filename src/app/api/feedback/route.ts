import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getBaseUrl } from "@/lib/baseUrl";
import { createFeedback } from "@/lib/feedback";
import { apiError, apiErrorText } from "@/lib/apiError";

const schema = z.object({
  message: z.string().trim().min(1, "Vul een omschrijving in.").max(4000),
  // data-URL; ruim boven wat een client-side verkleinde screenshot nodig
  // heeft, puur als vangnet tegen misbruik.
  screenshot: z
    .string()
    .max(8_000_000)
    .regex(/^data:image\/(png|jpeg|jpg|webp);base64,/)
    .optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const reports = await prisma.feedback.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, message: true, screenshot: true, status: true, createdAt: true,
      kind: true, questionId: true, questionSource: true, questionCategory: true,
      verseRef: true, questionSnapshot: true,
    },
  });

  return NextResponse.json({ reports }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiErrorText(parsed.error.issues[0]?.message ?? "Ongeldige invoer", 400);
  }

  const feedback = await createFeedback(user.id, parsed.data.message, parsed.data.screenshot, getBaseUrl(req));
  return NextResponse.json({ id: feedback.id });
}
