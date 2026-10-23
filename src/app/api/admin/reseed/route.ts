import { CFM_SOURCES } from "@/lib/studyContent/cfmSources";
import { z } from "zod";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import {
  cfmApprovedSnapshot,
  requireCfmApproval,
} from "@/lib/studyContent/sourceApproval";
import { studyStorage } from "@/lib/studyContent/storage";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getReseedJob, startReseedJob } from "@/lib/reseedJob";
import { apiError } from "@/lib/apiError";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);
  return null;
}

// Admin-versie van `npm run db:seed`: laadt content (boeken/hoofdstukken/
// oefeningen, podcastafleveringen, achievements) opnieuw in, zonder dat de
// admin daarvoor een terminal op de NAS hoeft te openen. Draait in-process
// met de gedeelde Prisma-client — geen losse container-exec nodig.
//
// Start de seed-run op de achtergrond (zie src/lib/reseedJob.ts) en
// antwoordt meteen, in plaats van te wachten tot runSeed helemaal klaar is
// — dat kon eerder een valse foutmelding geven als een reverse proxy de
// request eerder liet timeouten dan de seed klaar was. De adminpagina pollt
// GET hieronder voor de voortgang.
export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL))
    return await apiError("apiErrors.forbidden", 403);
  const raw = await req.text();
  if (raw.length > 2048) return await apiError("apiErrors.invalidInput", 400);
  const parsed = z
    .union([
      z.object({}).strict(),
      z
        .object({
          approvedSnapshot: z.string().regex(/^[a-f0-9]{64}$/),
          confirmDraftsOnly: z.literal(true),
        })
        .strict(),
    ])
    .safeParse(
      raw
        ? await Promise.resolve()
            .then(() => JSON.parse(raw))
            .catch(() => null)
        : {},
    );
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const user = await getCurrentUser();
  if (!user?.isAdmin) return await apiError("apiErrors.forbidden", 403);
  if ("approvedSnapshot" in parsed.data) {
    try {
      await requireCfmApproval(parsed.data.approvedSnapshot);
    } catch {
      return await apiError("studyPublishing.errors.CONFLICT", 409);
    }
  }
  const { started, job } = startReseedJob(
    prisma,
    "approvedSnapshot" in parsed.data
      ? { actor: user, approvedSnapshot: parsed.data.approvedSnapshot }
      : undefined,
  );
  return NextResponse.json(
    { started, job },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let studySource = null;
  try {
    const snapshot = await cfmApprovedSnapshot();
    let storageReady = false;
    try {
      await studyStorage();
      storageReady = true;
    } catch {}
    studySource = { snapshot, lessons: CFM_SOURCES.reduce((n, s) => n + s.manifest.lessons.length, 0), storageReady };
  } catch {}
  return NextResponse.json(
    { job: getReseedJob(), studySource },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
