import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/db";
import { setPodcastNotification } from "@/lib/profile/podcastNotifications";
import { getCurrentUser } from "@/lib/session";
import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";

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
  const preference = await prisma.$transaction(tx => setPodcastNotification(tx, user.id, podcastId, parsed.data.enabled));
  if (!preference) return await apiError("apiErrors.podcastNotFound", 404);
  return NextResponse.json(preference);
}
