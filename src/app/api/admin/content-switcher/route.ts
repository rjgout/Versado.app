import { dorpPrototypeEnabled } from "@/lib/dorp/access";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import {
  getContentSwitcherSettings,
  listContentCollectionsForAdmin,
  setContentCollectionVisibility,
  updateContentSwitcherSettings,
} from "@/lib/contentCollections";
import { prisma } from "@/lib/db";
import { hymnsTechnicallyAvailable } from "@/lib/hymnAvailability";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { apiError } from "@/lib/apiError";

const bodySchema = z.union([
  z.object({ enabled: z.boolean() }).strict(),
  z.object({ activity: z.enum(["hymns", "dorp"]), visibleToUsers: z.boolean() }).strict(),
  z.object({ contentCollectionId: z.string().min(1).max(256), visibleToUsers: z.boolean() }).strict(),
]);

async function snapshot() {
  const [settings, collections] = await Promise.all([getContentSwitcherSettings(), listContentCollectionsForAdmin()]);
  return { ...settings, collections, hymnsTechnicallyAvailable: hymnsTechnicallyAvailable(), dorpTechnicallyAvailable: dorpPrototypeEnabled() };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);
  return NextResponse.json(await snapshot(), { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return await apiError("apiErrors.forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const body = parsed.data;
  if ("enabled" in body) {
    await updateContentSwitcherSettings(body.enabled);
  } else if ("activity" in body) {
    await prisma.contentSwitcherSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...(body.activity === "dorp" ? { dorpVisibleToUsers: body.visibleToUsers } : { hymnsVisibleToUsers: body.visibleToUsers }) },
      update: body.activity === "dorp" ? { dorpVisibleToUsers: body.visibleToUsers } : { hymnsVisibleToUsers: body.visibleToUsers },
    });
  } else {
    try {
      await setContentCollectionVisibility(body.contentCollectionId, body.visibleToUsers);
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith("Er moet")
        ? error.message
        : "Deze content bestaat niet.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }
  return NextResponse.json(await snapshot(), { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
}
