import { z } from "zod";
import { NextResponse } from "next/server";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { apiError } from "@/lib/apiError";
import { getScriptureJob, startScriptureJob } from "@/lib/scriptureUpdateJob";
import { recentUpdateRuns } from "@/lib/contentUpdate";

const headers = { "Cache-Control": "no-store, private" };

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: await apiError("apiErrors.notLoggedIn", 401) };
  if (!user.isAdmin) return { error: await apiError("apiErrors.forbidden", 403) };
  return { user };
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }).strict(),
  z.object({ action: z.literal("prepare") }).strict(),
  z.object({ action: z.literal("mirror") }).strict(),
  z.object({ action: z.literal("publish"), planHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const [runs, needsReview] = await Promise.all([
    recentUpdateRuns(prisma, ["SCRIPTURE_CHECK", "SCRIPTURE_PREPARE", "SCRIPTURE_PUBLISH"]),
    prisma.chapterAudioCheck.count({ where: { status: "NEEDS_REVIEW" } }),
  ]);
  return NextResponse.json(
    { job: getScriptureJob(), needsReview, runs: runs.map((run) => ({ id: run.id, kind: run.kind, status: run.status, startedAt: run.startedAt, durationMs: run.durationMs, planHash: run.planHash })) },
    { headers },
  );
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return await apiError("apiErrors.forbidden", 403);
  const raw = await req.text();
  if (raw.length > 1024) return await apiError("apiErrors.invalidInput", 400);
  const parsed = bodySchema.safeParse(await Promise.resolve().then(() => JSON.parse(raw)).catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const { started, job } = startScriptureJob(prisma, parsed.data.action, {
    planHash: parsed.data.action === "publish" ? parsed.data.planHash : undefined,
    adminId: auth.user.id,
  });
  return NextResponse.json({ started, job }, { status: started ? 200 : 409, headers });
}
