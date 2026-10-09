import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

const bodySchema = z.object({ enabled: z.boolean() });

// De keuze hoort altijd bij de ingelogde gebruiker. De podcast-id uit de URL
// is alleen een bestaand inhouds-id; zonder bestaande podcast schrijven we
// geen losse voorkeur die later per ongeluk zichtbaar kan worden.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ podcastId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInputDot", 400);
  const { podcastId } = await params;
  const podcast = await prisma.podcast.findUnique({ where: { id: podcastId }, select: { id: true } });
  if (!podcast) return await apiError("apiErrors.podcastNotFound", 404);

  const preference = await prisma.podcastNotificationPreference.upsert({
    where: { userId_podcastId: { userId: user.id, podcastId } },
    create: { userId: user.id, podcastId, enabled: parsed.data.enabled, promptedAt: new Date() },
    update: { enabled: parsed.data.enabled, promptedAt: new Date() },
    select: { enabled: true },
  });
  return NextResponse.json(preference);
}
